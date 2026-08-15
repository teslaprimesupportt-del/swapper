# Work Log

---
Task ID: 1
Agent: main
Task: Audit, fix bugs, and verify dual-pipeline integration (Seed-VC + ComfyUI ReActor)

Work Log:
- Read all source files: studio-store, StudioShell, both adapters, all hooks, all tabs
- Ran tsc --noEmit — found zero errors in src/ (only unrelated examples/skills errors)
- Identified 6 bugs preventing the app from functioning
- Fixed FaceSwapTab Start Swap button (was missing onClick, now calls fs.startSwap)
- Fixed VoiceTab Start Streaming button (was missing onClick, now calls vc.startConversion)
- Fixed SettingsDialog: faceswap-type providers now route to setActiveFaceProvider (not setActiveProvider)
- Added face provider badge in StudioShell top bar
- Fixed canvas scaling: changed Math.max (cover) to Math.min (contain) to match CSS object-contain
- Fixed recording: buildCombinedStream now captures canvas stream when face swap is active
- Updated ModelsTab with user's exact clone commands (winget install git-xet, GIT_LFS_SKIP_SMUDGE=1)
- Final tsc --noEmit: zero errors in src/ confirmed

Stage Summary:
- All 6 bugs fixed, zero new TS errors introduced
- Both pipelines (voice + face) are now fully wired end-to-end
- Settings → Use button correctly routes faceswap providers to activeFaceProvider
- Recordings capture face-swapped canvas when active
