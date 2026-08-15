import { create } from 'zustand'

export type SessionStatus = 'idle' | 'connecting' | 'active' | 'paused' | 'ended' | 'error'
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'stopped'
export type CameraStatus = 'off' | 'requesting' | 'active' | 'error'
export type AudioStatus = 'off' | 'requesting' | 'active' | 'error'
export type ProviderType = 'rvc' | 'openvoice' | 'liveportrait' | 'wav2lip' | 'custom'
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

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
}

export interface AudioLevels {
  input: number
  output: number
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

  // AI Provider (BYOK)
  providers: AIProviderConfig[]
  activeProvider: AIProviderConfig | null
  setProviders: (p: AIProviderConfig[]) => void
  setActiveProvider: (p: AIProviderConfig | null) => void
  updateProviderStatus: (id: string, status: ConnectionStatus) => void

  // UI
  isMobileControlsOpen: boolean
  isSettingsOpen: boolean
  setMobileControlsOpen: (o: boolean) => void
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
    { id: 'rvc-male-1', name: 'Deep Male', provider: 'rvc', modelId: 'male-deep-01', description: 'Deep, resonant male voice' },
    { id: 'rvc-female-1', name: 'Soft Female', provider: 'rvc', modelId: 'female-soft-01', description: 'Soft, warm female voice' },
    { id: 'rvc-anime-1', name: 'Anime Style', provider: 'rvc', modelId: 'anime-style-01', description: 'Anime-inspired voice' },
    { id: 'openvoice-1', name: 'OpenVoice Clone', provider: 'openvoice', modelId: 'clone-01', description: 'Instant voice clone' },
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

  // AI Provider
  providers: [],
  activeProvider: null,
  setProviders: (p) => set({ providers: p }),
  setActiveProvider: (p) => set({ activeProvider: p }),
  updateProviderStatus: (id, status) => set((state) => ({
    providers: state.providers.map((p) =>
      p.id === id ? { ...p, status, lastTested: new Date().toISOString() } : p
    ),
  })),

  // UI
  isMobileControlsOpen: false,
  isSettingsOpen: false,
  setMobileControlsOpen: (o) => set({ isMobileControlsOpen: o }),
  setSettingsOpen: (o) => set({ isSettingsOpen: o }),
}))
