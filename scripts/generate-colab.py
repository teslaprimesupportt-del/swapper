# Generate the Colab notebook
import json

nb = {
    "nbformat": 4, "nbformat_minor": 0,
    "metadata": {
        "colab": {"provenance": []},
        "kernelspec": {"name": "python3", "display_name": "Python 3"},
        "language_info": {"name": "python"}
    },
    "cells": []
}

def md(source):
    nb["cells"].append({"cell_type": "markdown", "metadata": {}, "source": source.split("\n")})

def code(source):
    nb["cells"].append({"cell_type": "code", "metadata": {}, "source": source.split("\n"), "execution_count": None, "outputs": []})

md("""# AI Realtime Studio - Backend on Colab (Free T4 GPU)
## Face Swap (ComfyUI ReActor) + Voice Change (Seed-VC)

**Steps:**
1. Runtime → Change runtime type → **T4 GPU**
2. Run all cells (Runtime → Run all)
3. When Cell 4 finishes, copy the URLs into Studio Settings

| Service | Add as type | Endpoint |
|---------|-------------|----------|
| ComfyUI | `faceswap` | the `trycloudflare.com` URL |
| Seed-VC | `seed-vc` | the `gradio.live` URL |

> Keep Cell 4 running! Stopping it stops the servers.""")

code("""# Cell 1: Check GPU
!nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader""")

md("## Cell 2: Install ComfyUI + ReActor (~3-5 min)")

code("""# Cell 2: Install ComfyUI + ReActor + models
import os

if not os.path.exists('/content/ComfyUI'):
    !cd /content && git clone -q https://github.com/comfyanonymous/ComfyUI.git

REACTOR = '/content/ComfyUI/custom_nodes/comfyui-reactor-node'
if not os.path.exists(REACTOR):
    !cd /content/ComfyUI/custom_nodes && git clone -q https://github.com/Gourieff/comfyui-reactor-node.git

# inswapper model
MDIR = '/content/ComfyUI/models/insightface'
os.makedirs(MDIR, exist_ok=True)
INSWAP = os.path.join(MDIR, 'inswapper_128.onnx')
if not os.path.exists(INSWAP):
    !wget -q --show-progress -O {INSWAP} https://huggingface.co/ezioruan/inswapper_128.onnx/resolve/main/inswapper_128.onnx

# face detection models
for f in ['det_10g.onnx', 'genderage.onnx']:
    p = os.path.join(MDIR, f)
    if not os.path.exists(p):
        !wget -q -O {p} https://github.com/deepinsight/insightface/releases/download/v0.7/{f}

# GFPGAN
GDIR = '/content/ComfyUI/models/facerestore_models'
os.makedirs(GDIR, exist_ok=True)
GFP = os.path.join(GDIR, 'GFPGANv1.4.pth')
if not os.path.exists(GFP):
    !wget -q --show-progress -O {GFP} https://huggingface.co/ezioruan/GFPGANv1.4/resolve/main/GFPGANv1.4.pth

print('ComfyUI + ReActor + models installed!')""")

md("## Cell 2b: Install Seed-VC (~2 min)")

code("""# Cell 2b: Install Seed-VC
if not os.path.exists('/content/Seed-VC'):
    !cd /content && git clone -q https://github.com/Plachtaa/Seed-VC.git
print('Seed-VC cloned!')""")

md("## Cell 3: Install dependencies (~2 min)")

code("""# Cell 3: Dependencies
!cd /content/ComfyUI && pip install -q -r requirements.txt 2>/dev/null
!cd /content/ComfyUI/custom_nodes/comfyui-reactor-node && pip install -q -r requirements.txt 2>/dev/null
!cd /content/Seed-VC && pip install -q -r requirements.txt 2>/dev/null
print('All dependencies ready!')""")

md("""## Cell 4: Launch both servers + get public URLs
This cell starts both services and prints your public URLs.

> Keep this cell running!""")

code("""# Cell 4: Launch everything
import subprocess, time, urllib.request, re

PORT = 8188

# cloudflared for ComfyUI public URL (no token needed)
!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared
!chmod +x /usr/local/bin/cloudflared

# Start ComfyUI
comfy = subprocess.Popen(
    ['python', 'main.py', '--listen', '0.0.0.0', '--port', str(PORT), '--disable-metadata'],
    cwd='/content/ComfyUI', stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

# Start Seed-VC (Gradio share = public URL)
seedvc = subprocess.Popen(
    ['python', 'webui.py', '--share', '--server-port', '7860'],
    cwd='/content/Seed-VC', stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

print('Starting servers (~30s)...')

# Wait for ComfyUI
for _ in range(30):
    try:
        urllib.request.urlopen(f'http://127.0.0.1:{PORT}/system_stats', timeout=2)
        print('  ComfyUI ready')
        break
    except: time.sleep(2)

# Cloudflared tunnel for ComfyUI
cf = subprocess.Popen(
    ['cloudflared', 'tunnel', '--url', f'http://localhost:{PORT}', '--no-autoupdate'],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

comfy_url = ''
for _ in range(30):
    line = cf.stdout.readline().decode('utf-8', errors='ignore')
    m = re.search(r'(https://[a-z0-9-]+\.trycloudflare\.com)', line)
    if m: comfy_url = m.group(1); break
    time.sleep(1)

# Seed-VC Gradio URL
seedvc_url = ''
for _ in range(60):
    line = seedvc.stdout.readline().decode('utf-8', errors='ignore')
    m = re.search(r'(https://[a-z0-9-]+\.gradio\.live)', line)
    if m: seedvc_url = m.group(1); break
    time.sleep(1)

print()
print('=' * 55)
print('  YOUR PUBLIC URLs')
print('=' * 55)
print(f'Face Swap: {comfy_url}')
print(f'  -> Settings > Add Provider > type: faceswap')
print()
print(f'Voice Change: {seedvc_url}')
print(f'  -> Settings > Add Provider > type: seed-vc')
print('=' * 55)
print('Keep this cell running!')""")

with open('/home/z/my-project/scripts/studio-colab.ipynb', 'w') as f:
    json.dump(nb, f, indent=1)
print('Notebook written!')
