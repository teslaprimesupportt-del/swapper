# AI REALTIME STUDIO — Work Log

---
Task ID: 0-a
Agent: Main Agent
Task: Read and understand the full 4,048-line PRD + Technical Specification

Work Log:
- Read all 102 sections of the PRD
- Identified it as a Type 3 (Interactive Web Development) task
- Confirmed greenfield repository (empty)
- Understood the 20-point non-negotiable development contract
- Understood the 17-phase development plan
- Understood the Code Integrity Protocol (CI-CEP) requirements

Stage Summary:
- PRD fully read and understood
- Repository is empty greenfield
- Document explicitly requires discovery-first approach (§61, §91)

---
Task ID: 0-b
Agent: Sub-agent (general-purpose)
Task: Research realtime video AI providers

Work Log:
- Investigated 12+ providers: Replicate, Fal.ai, Banana.dev, RunPod, HuggingFace, OpenAI, Stability AI, Akool, HeyGen, Synthesia, Deepbrain AI, and others
- Verified each against current official documentation
- Discovered critical market gap: managed realtime webcam transformation APIs are nearly empty
- Only Akool offers turnkey realtime face swap via WebRTC
- Most "AI avatar" platforms (HeyGen, D-ID, Tavus) generate synthetic avatars, NOT transform webcam feeds
- Identified self-hosted models (InsightFace, SimSwap, Deep-Live-Cam) as the path for style/background/VFX

Stage Summary:
- Akool: ONLY turnkey managed API for realtime webcam face swap ($0.17-0.43/min)
- Fal.ai: Best realtime WebSocket INFRASTRUCTURE but no turnkey video model
- RunPod: Best GPU infrastructure for self-hosting ($0.0002-0.003/sec)
- Key finding: Must self-host for style transfer, background, VFX, appearance

---
Task ID: 0-c
Agent: Sub-agent (general-purpose)
Task: Research realtime voice conversion providers (NOT TTS)

Work Log:
- Investigated RVC, So-VITS-SVC, w-okada/voice-changer, ElevenLabs VC, Wondera, Dubbing AI, Voicemod, Altered Studio, LLVC, StreamVC, Seed-VC
- Verified critical distinction: voice conversion ≠ TTS
- RVC confirmed as best open-source option (90-170ms latency, massive ecosystem)
- Wondera and Dubbing AI are interesting managed API options but unverified
- LLVC research model claims <20ms on CPU — worth monitoring
- Web Audio API can only do signal processing, not AI voice conversion

Stage Summary:
- RVC self-hosted: Best quality, proven, 90-170ms, free (needs GPU)
- w-okada/voice-changer: Best runtime wrapper for RVC
- Wondera: Claims <50ms, managed API, needs testing
- ElevenLabs: Streaming VC endpoint exists but latency undocumented

---
Task ID: 0-d, 0-e, 0-f
Agent: Sub-agent (general-purpose)
Task: Research lip sync, media transport, and GPU infrastructure

Work Log:
- Lip Sync: MuseTalk (Tencent) confirmed as best open-source realtime lip sync (30-60fps, free). SyncLabs sync-react-1 best API option (~12ms). D-ID/Tavus are avatar platforms, wrong category.
- Media Transport: LiveKit is the clear winner — Agents framework supports exactly the subscribe→process→republish pattern needed. Self-hostable, open source. Agora/Daily lack server-side participant capabilities.
- GPU: RunPod best overall (serverless + pods + per-second billing). TensorDock cheapest H100. Vast.ai cheapest overall but volatile. Fal.ai best for realtime WebSocket inference.

Stage Summary:
- Lip Sync: MuseTalk (self-hosted) + SyncLabs (API fallback)
- Transport: LiveKit (self-hosted or cloud)
- GPU: RunPod Secure Cloud (primary) + serverless overflow

---
Task ID: 0-g
Agent: Sub-agent (general-purpose)
Task: Research design system resources

Work Log:
- Evaluated 9 body/UI fonts, 4 display fonts, 4 monospace fonts
- Verified all are free for commercial use (SIL OFL or equivalent)
- Evaluated 4 icon libraries (Lucide, Iconify, Phosphor, Tabler)
- Evaluated 3 animation libraries (Motion, React Spring, GSAP)
- Verified shadcn/ui works with Vite (officially supported)
- Evaluated Three.js/R3F for selective 3D effects

Stage Summary:
- Fonts: Geist Sans (body) + Space Grotesk/Clash Display (display) + JetBrains Mono (mono)
- Icons: Lucide (primary) + Phosphor (secondary)
- Animation: Motion (primary) + GSAP (cinematic scroll)
- Components: shadcn/ui + Tailwind CSS 4
- 3D: R3F (lazy-loaded, selective use only)

---
Task ID: 0-h, 0-i, 0-j
Agent: Main Agent
Task: Compile architecture options, design directions, and present recommendation

Work Log:
- Designed 3 architecture options (Lean, Balanced, Premium) with cost analysis
- Lean: ~$200-1,800/mo but cannot deliver mandatory features (style, background, VFX)
- Balanced: ~$400-2,500/mo, delivers ALL mandatory features, RECOMMENDED
- Premium: ~$3,500-18,000/mo, over-engineered for MVP
- Proposed 3 design directions: Obsidian Command, Lumière Studio, Void Lab
- Recommended Lumière Studio (hybrid with Obsidian Command elements)
- Identified 5 high-impact risks and 5 open questions
- Wrote full ARCHITECTURE_RECOMMENDATION.md

Stage Summary:
- Full architecture recommendation written to ARCHITECTURE_RECOMMENDATION.md
- Awaiting product owner approval on: architecture tier, design direction, open questions
- No code written — per PRD §61 and §91 requirements

---
Task ID: 1
Agent: Main Agent
Task: Build AI REALTIME STUDIO MVP foundation with zero-budget BYOK strategy

Work Log:
- Initialized fullstack dev environment (Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui)
- Designed and pushed Prisma schema: User, Session, Recording, VoiceModel, AIProvider
- Created cinematic dark theme with custom CSS tokens (studio-glow, studio-accent, studio-danger, etc.)
- Built Zustand store (studio-store.ts) managing: session, camera, audio, voice, recording, BYOK providers, UI state
- Created custom hooks: useCamera (WebRTC), useAudio (Web Audio API + level monitoring), useRecording (MediaRecorder), useSessionTimer
- Built full StudioShell component with:
  - Permission gate (pre-session landing with camera/mic request)
  - Active studio: camera preview with overlay controls
  - Desktop: multi-panel layout (camera + side panel)
  - Mobile: full-screen camera + spring-animated bottom sheet
  - Top bar: session timer, recording indicator, provider status badge
  - Floating control bar: camera toggle, mic toggle, record, flip camera (mobile), end session
  - Side panel tabs: VOICE (presets, pitch, clone), AUDIO (levels, noise gate, headphone detection), MODELS
  - BYOK Settings dialog: add/test/activate AI providers (RVC, OpenVoice, LivePortrait, Wav2Lip, custom)
- Browser-verified all interactions via Agent Browser:
  - Landing page renders correctly
  - Start session flow works (camera request, permission handling)
  - Settings dialog: form validation, provider add, activate, close
  - Voice tab: toggle conversion, select presets, pitch slider
  - Audio tab: noise gate controls
  - Mobile (390x844): landing, active studio, bottom sheet with tabs
  - Desktop (1440x900): full layout with side panel
  - Zero console errors
- Lint: clean (zero errors)

Stage Summary:
- Fully functional studio MVP running at / route
- Zero-budget BYOK architecture: users bring their own AI provider endpoints
- Responsive: desktop multi-panel + mobile full-screen with bottom sheet
- All core UI flows working: session lifecycle, camera, audio, recording, voice presets, provider management
- Next step: WebSocket realtime service for AI pipeline integration
---
Task ID: 1
Agent: main
Task: Build Seed-VC adapter for AI REALTIME STUDIO

Work Log:
- Fetched and analyzed Seed-VC GitHub repo (https://github.com/Plachtaa/seed-vc)
- Created /src/lib/seed-vc-adapter.ts - Full Seed-VC client class with: audio capture, 48kHz->22kHz resampling, WAV encoding, chunking, Gradio HTTP API integration, crossfade playback scheduling, VAD, observer pattern
- Created /src/hooks/use-voice-conversion.ts - React hook wiring adapter to studio (connect, setReferenceAudio, recordReference, startConversion, stopConversion, disconnect)
- Updated /src/stores/studio-store.ts - Added seed-vc and faceswap provider types, updated voice presets to Seed-VC models (realtime/quality/singing)
- Updated /src/components/studio/StudioShell.tsx - Added Seed-VC controls (reference audio upload/record, pipeline connect/stream buttons, latency/chunks stats), updated BYOK settings dialog, updated models tab with quick start guide, wired voice conversion into session start/stop
- All files compile with 0 TypeScript errors

Stage Summary:
- Seed-VC adapter is fully built and integrated into the studio UI
- User workflow: Settings > Add Seed-VC provider (paste Gradio URL) > Voice tab > Upload/record reference > Connect > Start Streaming
- Adapter handles: zero-shot voice conversion, real-time audio pipeline, latency monitoring, chunk statistics
---
Task ID: 1
Agent: main
Task: Build Seed-VC adapter service and React hook for BYOK voice conversion integration

Work Log:
- Created /home/z/my-project/src/services/ directory
- Built seed-vc-adapter.ts (~1180 lines): SeedVCAdapter class, SeedVCRealtimePipeline class, audio codec utilities (encode/decode WAV, resample, base64), Gradio API communication (named endpoints + legacy /api/predict), factory function createSeedVCAdapter()
- Built use-seed-vc.ts (~472 lines): React hook wrapping adapter with studio store integration (provider endpoint, voice preset, pitch, noise gate, audio levels)
- Fixed TypeScript strict mode issues: type narrowing in finally block, Set.forEach iteration, Float32Array ArrayBufferLike compatibility, Zustand setter callback vs value
- Full project tsc --noEmit passes with zero errors on both files

Stage Summary:
- SeedVCAdapter: connect/disconnect, setReferenceAudio (from Float32Array, AudioBuffer, or File), convertChunk (real-time), convertFile (offline), testConnection, Gradio schema auto-detection, state change listeners
- SeedVCRealtimePipeline: ScriptProcessorNode-based mic capture, 0.18s chunk size, 2.5s left context, noise gate, auto-playback via AudioBufferSourceNode
- useSeedVC hook: full studio store binding, auto-connect/disconnect lifecycle, reference recording (3s mic clip), pipeline start/stop, output level metering
- Files: src/services/seed-vc-adapter.ts, src/hooks/use-seed-vc.ts
