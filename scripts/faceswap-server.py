#!/usr/bin/env python3
"""Lightweight Face Swap Server - ComfyUI-compatible API."""

import argparse, io, json, time, traceback, uuid, base64
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Thread, Lock
from urllib.parse import urlparse, parse_qs
import numpy as np
from PIL import Image

MODELS_DIR = "/home/z/ComfyUI-Reactor-Fast-Face-Swap-CPU/models/insightface"


class FaceSwapEngine:
    def __init__(self, models_dir: str):
        self.models_dir = Path(models_dir)
        self._lock = Lock()
        self._load_models()

    def _ort_opts(self):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        opts.intra_op_num_threads = 2
        return opts

    def _load_models(self):
        import onnxruntime as ort
        self.det_session = ort.InferenceSession(
            str(self.models_dir / "models/buffalo_l/det_10g.onnx"),
            sess_options=self._ort_opts())
        self.lmk_session = ort.InferenceSession(
            str(self.models_dir / "models/buffalo_l/2d106det.onnx"),
            sess_options=self._ort_opts())
        self.swap_session = ort.InferenceSession(
            str(self.models_dir / "inswapper_128.onnx"),
            sess_options=self._ort_opts())
        print("[FaceSwap] Models loaded (lightweight)")

    def _detect(self, img_bgr):
        import cv2
        h, w = img_bgr.shape[:2]
        sz = 320
        inp = cv2.resize(img_bgr, (sz, sz))
        blob = np.expand_dims(np.transpose(inp, (2, 0, 1)), 0).astype(np.float32)
        scores, bboxes, kpss = self.det_session.run(None, {"input.1": blob})
        if len(bboxes[0]) == 0:
            return None
        best = int(np.argmax(scores[0][:, 0]))
        bbox = bboxes[0][best]
        kps = kpss[0][best]
        sx, sy = w / sz, h / sz
        bbox[0] *= sx; bbox[1] *= sy; bbox[2] *= sx; bbox[3] *= sy
        kps[:, 0] *= sx; kps[:, 1] *= sy
        return {"bbox": bbox[:4].astype(np.int32), "kps": kps.astype(np.float32)}

    def _landmarks(self, img_bgr, kps):
        from insightface.utils.face_align import norm_crop
        a = norm_crop(img_bgr, kps, image_size=192)
        blob = np.expand_dims(np.transpose(a, (2, 0, 1)), 0).astype(np.float32)
        return self.lmk_session.run(None, {"input.1": blob})[0][0]

    def swap_face(self, source, reference):
        import cv2
        from insightface.utils.face_align import norm_crop
        with self._lock:
            ref = cv2.cvtColor(np.array(reference), cv2.COLOR_RGB2BGR)
            src = cv2.cvtColor(np.array(source), cv2.COLOR_RGB2BGR)
            rd = self._detect(ref)
            if rd is None: raise ValueError("No face in reference")
            sd = self._detect(src)
            if sd is None: raise ValueError("No face in source")
            rl = self._landmarks(ref, rd["kps"])
            sl = self._landmarks(src, sd["kps"])
            ra = norm_crop(ref, rl, image_size=128)
            sa = norm_crop(src, sl, image_size=128)
            bs = np.expand_dims(np.transpose(sa, (2, 0, 1)), 0).astype(np.float32)
            br = np.expand_dims(np.transpose(ra, (2, 0, 1)), 0).astype(np.float32)
            res = self.swap_session.run(None, {"source": bs, "target": br})[0][0]
            res = np.clip(np.transpose(res, (1, 2, 0)), 0, 255).astype(np.uint8)
            out = src.copy()
            bb = sd["bbox"]
            mx = int((bb[2]-bb[0])*0.15)
            my = int((bb[3]-bb[1])*0.15)
            x1 = max(0, bb[0]-mx); y1 = max(0, bb[1]-my)
            x2 = min(out.shape[1], bb[2]+mx)
            y2 = min(out.shape[0], bb[3]+my)
            pil = Image.fromarray(res).resize((x2-x1, y2-y1), Image.LANCZOS)
            out[y1:y2, x1:x2] = np.array(pil)
            return Image.fromarray(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))


class JobQueue:
    def __init__(self):
        self.jobs = {}
        self.out = Path("/tmp/faceswap-output")
        self.out.mkdir(parents=True, exist_ok=True)
    def create(self):
        pid = str(uuid.uuid4())
        self.jobs[pid] = {"status": "pending", "outputs": None, "error": None}
        return pid
    def complete(self, pid, fn):
        if pid in self.jobs:
            self.jobs[pid] = {"status": "completed", "outputs": {"9": {"images": [{"filename": fn, "subfolder": "", "type": "output"}]}}, "error": None}
    def fail(self, pid, err):
        if pid in self.jobs:
            self.jobs[pid] = {"status": "error", "error": err, "outputs": None}
    def get(self, pid):
        return self.jobs.get(pid)


engine = None
queue = None


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _json(self, d, s=200):
        b = json.dumps(d).encode()
        self.send_response(s)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        p = urlparse(self.path).path
        q = parse_qs(urlparse(self.path).query)
        if p == "/system_stats":
            r = {"system": {"devices": [{"name": "CPU", "type": "cpu", "vram_total": 0, "vram_free": 0}]}, "queue": {"running": [], "pending": 0}}
            self._json(r)
        elif p.startswith("/history/"):
            pid = p.split("/")[-1]
            self._json({pid: queue.get(pid) or {}})
        elif p == "/view":
            fn = q.get("filename", [""])[0]
            fp = queue.out / fn
            if fp.exists():
                d = fp.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(d)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(d)
            else:
                self.send_error(404)
        else:
            self.send_error(404)

    def do_POST(self):
        if urlparse(self.path).path == "/prompt":
            self._handle_prompt()
        else:
            self.send_error(404)

    def _handle_prompt(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            prompt = body.get("prompt", {})
            rd = sd = None
            for _, n in prompt.items():
                if n.get("class_type") == "LoadImage":
                    img = n.get("inputs", {}).get("image", "")
                    if img:
                        if rd is None: rd = img
                        elif sd is None: sd = img
            if not sd or not rd:
                self._json({"prompt_id": "", "node_errors": {"error": "Missing images"}})
                return
            pid = queue.create()
            Thread(target=self._run, args=(pid, sd, rd), daemon=True).start()
            self._json({"prompt_id": pid, "number": 0, "node_errors": {}})
        except Exception as e:
            traceback.print_exc()
            self._json({"prompt_id": "", "node_errors": {"error": str(e)}})

    @staticmethod
    def _run(pid, sb, rb):
        try:
            s = H._dec(sb)
            r = H._dec(rb)
            res = engine.swap_face(s, r)
            fn = f"swap_{pid[:8]}.png"
            res.save(str(queue.out / fn), "PNG")
            queue.complete(pid, fn)
        except Exception as e:
            print(f"[FaceSwap] {pid} failed: {e}")
            traceback.print_exc()
            queue.fail(pid, str(e))

    @staticmethod
    def _dec(d):
        if "," in d: d = d.split(",", 1)[1]
        return Image.open(io.BytesIO(base64.b64decode(d))).convert("RGB")


def main():
    global engine, queue
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8188)
    p.add_argument("--models-dir", default=MODELS_DIR)
    a = p.parse_args()
    print(f"[FaceSwap] Starting on {a.host}:{a.port}")
    engine = FaceSwapEngine(a.models_dir)
    queue = JobQueue()
    srv = HTTPServer((a.host, a.port), H)
    print("[FaceSwap] Ready")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.server_close()


if __name__ == "__main__":
    main()
