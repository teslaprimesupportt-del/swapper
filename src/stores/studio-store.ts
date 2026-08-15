import { create } from 'zustand'

// ─── localStorage persistence helpers (safe for SSR) ───
const STORAGE_KEY_PROVIDERS = 'studio-providers'
const STORAGE_KEY_ACTIVE_PROVIDER = 'studio-active-provider'
const STORAGE_KEY_ACTIVE_FACE_PROVIDER = 'studio-active-face-provider'

function loadProviders(): AIProviderConfig[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROVIDERS)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function persistProviders(providers: AIProviderConfig[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY_PROVIDERS, JSON.stringify(providers))
  } catch { /* quota exceeded, ignore */ }
}

function loadActiveProvider(): AIProviderConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_PROVIDER)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function persistActiveProvider(p: AIProviderConfig | null) {
  if (typeof window === 'undefined') return
  try {
    if (p) localStorage.setItem(STORAGE_KEY_ACTIVE_PROVIDER, JSON.stringify(p))
    else localStorage.removeItem(STORAGE_KEY_ACTIVE_PROVIDER)
  } catch { /* ignore */ }
}

function loadActiveFaceProvider(): AIProviderConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_FACE_PROVIDER)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function persistActiveFaceProvider(p: AIProviderConfig | null) {
  if (typeof window === 'undefined') return
  try {
    if (p) localStorage.setItem(STORAGE_KEY_ACTIVE_FACE_PROVIDER, JSON.stringify(p))
    else localStorage.removeItem(STORAGE_KEY_ACTIVE_FACE_PROVIDER)
  } catch { /* ignore */ }
}

export type SessionStatus = 'idle' | 'connecting' | 'active' | 'paused' | 'ended' | 'error'
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped'
export type CameraStatus = 'off' | 'requesting' | 'active' | 'error'
export type AudioStatus = 'off' | 'requesting' | 'active' | 'error'
export type ProviderType = 'seed-vc' | 'rvc' | 'openvoice' | 'liveportrait' | 'wav2lip' | 'faceswap' | 'custom'
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type FaceSwapStatus = 'off' | 'connecting' | 'active' | 'error'
export type FaceSwapFps = 1 | 2 | 3 | 5

export interface VoicePreset {
  id: string
  name: string
  provider: ProviderType
  modelId: string
  description?: string
  icon?: string
}

export interface AIProviderConfig {
  id?: string
  name: string
  type: ProviderType
  endpoint: string
  apiKey: string
  status: ConnectionStatus
  lastTested?: string
  // ComfyUI-specific options
  faceRestoreModel?: string
  faceDetectionModel?: string
  customWorkflowJson?: string
}

export interface AudioLevels {
  input: number
  output: number
}

export interface FaceSwapState {
  status: FaceSwapStatus
  fps: FaceSwapFps
  latencyMs: number
  framesProcessed: number
  errorMessage: string | null
  hasReferenceFace: boolean
  faceSwapEnabled: boolean
}

interface StudioState {
  // Session
  sessionId: string | null
  sessionStatus: SessionStatus
  sessionDuration: number
  startSession: () => void
  endSession: () => void
  setSessionDuration: (d: number) => void

  // Camera
  cameraStatus: CameraStatus
  cameraFacingMode: 'user' | 'environment'
  setCameraStatus: (s: CameraStatus) => void
  toggleCameraFacing: () => void

  // Audio
  audioStatus: AudioStatus
  audioLevels: AudioLevels
  isMuted: boolean
  headphonesDetected: boolean
  noiseGateEnabled: boolean
  noiseGateThreshold: number
  setAudioStatus: (s: AudioStatus) => void
  setAudioLevels: (l: AudioLevels) => void
  setMuted: (m: boolean) => void
  setHeadphonesDetected: (d: boolean) => void
  setNoiseGateEnabled: (e: boolean) => void
  setNoiseGateThreshold: (t: number) => void

  // Voice
  activeVoicePreset: VoicePreset | null
  voicePresets: VoicePreset[]
  voicePitch: number
  voiceConversionEnabled: boolean
  setActiveVoicePreset: (p: VoicePreset | null) => void
  setVoicePresets: (p: VoicePreset[]) => void
  setVoicePitch: (p: number) => void
  setVoiceConversionEnabled: (e: boolean) => void

  // Recording
  recordingStatus: RecordingStatus
  recordingDuration: number
  setRecordingStatus: (s: RecordingStatus) => void
  setRecordingDuration: (d: number) => void

  // Face Swap
  faceSwap: FaceSwapState
  activeFaceProvider: AIProviderConfig | null
  setActiveFaceProvider: (p: AIProviderConfig | null) => void
  setFaceSwapEnabled: (e: boolean) => void
  setFaceSwapFps: (f: FaceSwapFps) => void
  setFaceSwapStatus: (s: FaceSwapStatus) => void
  setFaceSwapLatency: (ms: number) => void
  setFaceSwapFramesProcessed: (n: number) => void
  setFaceSwapError: (msg: string | null) => void
  setFaceSwapHasReferenceFace: (has: boolean) => void

  // AI Provider (BYOK)
  providers: AIProviderConfig[]
  activeProvider: AIProviderConfig | null
  setProviders: (p: AIProviderConfig[]) => void
  setActiveProvider: (p: AIProviderConfig | null) => void
  updateProviderStatus: (id: string, status: ConnectionStatus) => void

  // UI
  isMobileControlsOpen: boolean
  sidePanelOpen: boolean
  isSettingsOpen: boolean
  setMobileControlsOpen: (o: boolean) => void
  setSidePanelOpen: (o: boolean) => void
  setSettingsOpen: (o: boolean) => void
}

export const useStudioStore = create<StudioState>((set) => ({
  // Session
  sessionId: null,
  sessionStatus: 'idle',
  sessionDuration: 0,
  startSession: () => set({
    sessionId: crypto.randomUUID(),
    sessionStatus: 'active',
    sessionDuration: 0,
  }),
  endSession: () => set({
    sessionStatus: 'ended',
  }),
  setSessionDuration: (d) => set({ sessionDuration: d }),

  // Camera
  cameraStatus: 'off',
  cameraFacingMode: 'user',
  setCameraStatus: (s) => set({ cameraStatus: s }),
  toggleCameraFacing: () => set((state) => ({
    cameraFacingMode: state.cameraFacingMode === 'user' ? 'environment' : 'user',
  })),

  // Audio
  audioStatus: 'off',
  audioLevels: { input: 0, output: 0 },
  isMuted: false,
  headphonesDetected: false,
  noiseGateEnabled: true,
  noiseGateThreshold: -40,
  setAudioStatus: (s) => set({ audioStatus: s }),
  setAudioLevels: (l) => set({ audioLevels: l }),
  setMuted: (m) => set({ isMuted: m }),
  setHeadphonesDetected: (d) => set({ headphonesDetected: d }),
  setNoiseGateEnabled: (e) => set({ noiseGateEnabled: e }),
  setNoiseGateThreshold: (t) => set({ noiseGateThreshold: t }),

  // Voice
  activeVoicePreset: null,
  voicePresets: [
    { id: 'default', name: 'Original Voice', provider: 'custom', modelId: 'none', description: 'No voice transformation' },
    { id: 'seed-vc-realtime', name: 'Seed-VC Real-Time', provider: 'seed-vc', modelId: 'seed-uvit-tat-xlsr-tiny', description: 'Zero-shot real-time VC (25M params)' },
    { id: 'seed-vc-quality', name: 'Seed-VC Quality', provider: 'seed-vc', modelId: 'seed-uvit-whisper-small-wavenet', description: 'Offline high-quality VC (98M params)' },
    { id: 'seed-vc-singing', name: 'Seed-VC Singing', provider: 'seed-vc', modelId: 'seed-uvit-whisper-base', description: 'Singing voice conversion (200M params)' },
    { id: 'rvc-male-1', name: 'Deep Male', provider: 'rvc', modelId: 'male-deep-01', description: 'Deep, resonant male voice' },
  ],
  voicePitch: 0,
  voiceConversionEnabled: false,
  setActiveVoicePreset: (p) => set({ activeVoicePreset: p }),
  setVoicePresets: (p) => set({ voicePresets: p }),
  setVoicePitch: (p) => set({ voicePitch: p }),
  setVoiceConversionEnabled: (e) => set({ voiceConversionEnabled: e }),

  // Recording
  recordingStatus: 'idle',
  recordingDuration: 0,
  setRecordingStatus: (s) => set({ recordingStatus: s }),
  setRecordingDuration: (d) => set({ recordingDuration: d }),

  // Face Swap
  faceSwap: {
    status: 'off',
    fps: 3,
    latencyMs: 0,
    framesProcessed: 0,
    errorMessage: null,
    hasReferenceFace: false,
    faceSwapEnabled: false,
  },
  activeFaceProvider: loadActiveFaceProvider(),
  setActiveFaceProvider: (p) => { set({ activeFaceProvider: p }); persistActiveFaceProvider(p) },
  setFaceSwapEnabled: (e) => set((s) => ({
    faceSwap: { ...s.faceSwap, faceSwapEnabled: e },
  })),
  setFaceSwapFps: (f) => set((s) => ({
    faceSwap: { ...s.faceSwap, fps: f },
  })),
  setFaceSwapStatus: (status) => set((s) => ({
    faceSwap: { ...s.faceSwap, status },
  })),
  setFaceSwapLatency: (ms) => set((s) => ({
    faceSwap: { ...s.faceSwap, latencyMs: ms },
  })),
  setFaceSwapFramesProcessed: (n) => set((s) => ({
    faceSwap: { ...s.faceSwap, framesProcessed: n },
  })),
  setFaceSwapError: (msg) => set((s) => ({
    faceSwap: { ...s.faceSwap, errorMessage: msg },
  })),
  setFaceSwapHasReferenceFace: (has) => set((s) => ({
    faceSwap: { ...s.faceSwap, hasReferenceFace: has },
  })),

  // AI Provider (BYOK)
  providers: loadProviders(),
  activeProvider: loadActiveProvider(),
  setProviders: (p) => { set({ providers: p }); persistProviders(p) },
  setActiveProvider: (p) => { set({ activeProvider: p }); persistActiveProvider(p) },
  updateProviderStatus: (id, status) => set((state) => {
    const updated = state.providers.map((p) =>
      p.id === id ? { ...p, status, lastTested: new Date().toISOString() } : p
    )
    persistProviders(updated)
    return { providers: updated }
  }),

  // UI
  isMobileControlsOpen: false,
  sidePanelOpen: true,
  isSettingsOpen: false,
  setMobileControlsOpen: (o) => set({ isMobileControlsOpen: o }),
  setSidePanelOpen: (o) => set({ sidePanelOpen: o }),
  setSettingsOpen: (o) => set({ isSettingsOpen: o }),
}))
