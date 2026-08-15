# Work Log

---
Task ID: 1
Agent: main
Task: Fix client-side crash, audio pipeline idle, settings, dead code

Work Log:
- Diagnosed client-side crash: hydration mismatch from zustand store loading localStorage data on client but not server, plus framer-motion initial/animate state mismatch
- Fixed by making page.tsx use `next/dynamic` with `ssr: false` and `'use client'`
- Fixed Railway 502: changed `HOSTNAME=` (empty) to `HOSTNAME=0.0.0.0 PORT=3000` in start script
- Fixed audio pipeline idle: added ScriptProcessorNode to use-audio.ts to keep pipeline active
- Fixed voice conversion double mic: VoiceTab now dispatches `studio:start-voice-conversion` event instead of creating second getUserMedia; StudioShell listens and passes session's existing mic stream
- Added ComfyUI-specific config to SettingsDialog: face restore model (GFPGAN v1.4/v1.3/CodeFormer/None) and detection model (RetinaFace ResNet50/Mobile/OpenCV)
- Extended AIProviderConfig type with faceRestoreModel, faceDetectionModel, customWorkflowJson fields
- Deleted dead code: src/lib/seed-vc-adapter.ts (old broken 647-line adapter), src/hooks/use-seed-vc.ts (unused hook)
- Verified build succeeds, production server starts and renders without client-side error

Stage Summary:
- Client-side crash: FIXED (dynamic import with ssr:false)
- Railway 502: FIXED (HOSTNAME=0.0.0.0)
- Audio pipeline idle: FIXED (ScriptProcessorNode keeps pipeline active)
- Voice conversion: FIXED (uses session mic stream, not second getUserMedia)
- Face swap: Was already correct (uses StudioRefsContext, canvas mirror matches video scaleX(-1))
- Settings: ENHANCED (ComfyUI-specific fields added)
- Dead code: REMOVED (2 files deleted)
