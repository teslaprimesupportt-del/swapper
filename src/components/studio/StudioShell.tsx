'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Video, VideoOff, Mic, MicOff, Settings, Circle, Square,
  RotateCcw, ChevronUp, ChevronDown, MonitorSpeaker, Headphones,
  Radio, Clock, Zap, AlertCircle, Download, Upload, Play,
  Volume2, Link2, Unplug
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { useCamera } from '@/hooks/use-camera'
import { useAudio } from '@/hooks/use-audio'
import { useRecording } from '@/hooks/use-recording'
import { useSessionTimer } from '@/hooks/use-session-timer'
import { useVoiceConversion } from '@/hooks/use-voice-conversion'
import { useStudioStore, type VoicePreset, type ProviderType } from '@/stores/studio-store'
import { cn } from '@/lib/utils'

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const voiceIcons: Record<ProviderType, string> = {
  'seed-vc': '🌿',
  rvc: '🎙️',
  openvoice: '🧬',
  liveportrait: '🎭',
  wav2lip: '👄',
  faceswap: '👤',
  custom: '⚙️',
}

// ─── AUDIO LEVEL METER ─────────────────────────────
function AudioLevelMeter({ level, label }: { level: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-studio-muted-foreground/70 uppercase tracking-wider">{label}</span>
        <span className="font-mono text-studio-muted-foreground/50">{Math.round(level)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-studio-border/50 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            width: `${level}%`,
            background: level > 80
              ? 'oklch(0.65 0.22 25)'
              : level > 50
                ? 'oklch(0.78 0.16 75)'
                : 'oklch(0.7 0.18 155)',
          }}
          transition={{ duration: 0.1 }}
        />
      </div>
    </div>
  )
}

// ─── VOICE PRESET CARD ──────────────────────────────
function VoicePresetCard({
  preset,
  isActive,
  onSelect
}: {
  preset: VoicePreset
  isActive: boolean
  onSelect: (p: VoicePreset) => void
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(preset)}
      className={cn(
        'w-full text-left p-3 rounded-lg border transition-all duration-200',
        'hover:bg-accent/50',
        isActive
          ? 'border-studio-accent bg-studio-accent/10 shadow-[0_0_15px_oklch(0.72_0.18_265/0.15)]'
          : 'border-studio-border/50 bg-card/50'
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-xl" role="img" aria-label={preset.provider}>
          {voiceIcons[preset.provider]}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{preset.name}</p>
          <p className="text-xs text-studio-muted-foreground/60 truncate">{preset.description}</p>
        </div>
        {isActive && (
          <div className="w-2 h-2 rounded-full bg-studio-accent animate-pulse-glow" />
        )}
      </div>
    </motion.button>
  )
}

// ─── MAIN STUDIO COMPONENT ──────────────────────────
export default function StudioShell() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const combinedStreamRef = useRef<MediaStream | null>(null)
  const [showPermissionGate, setShowPermissionGate] = useState(true)

  const {
    cameraStatus, audioStatus, sessionStatus, sessionDuration,
    recordingStatus, recordingDuration,
    audioLevels, isMuted, headphonesDetected,
    activeProvider, voiceConversionEnabled, isMobileControlsOpen,
    startSession, endSession,
    setMobileControlsOpen,
  } = useStudioStore()

  const { startCamera, stopCamera, flipCamera } = useCamera(videoRef)
  const { startAudio, stopAudio, toggleMute, audioStream } = useAudio()
  const { toggleRecording } = useRecording()
  const vc = useVoiceConversion()
  useSessionTimer()

  // Build combined stream for recording
  const buildCombinedStream = useCallback(async () => {
    const tracks: MediaStreamTrack[] = []
    if (videoRef.current?.srcObject) {
      const vidStream = videoRef.current.srcObject as MediaStream
      tracks.push(...vidStream.getVideoTracks())
    }
    // We'll add audio tracks when audio is active
    const audioTracks = [] as MediaStreamTrack[]
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      // This gets the active audio stream tracks
    } catch { /* no-op */ }
    combinedStreamRef.current = new MediaStream(tracks)
    return combinedStreamRef.current
  }, [])

  // Start session handler
  const handleStartSession = useCallback(async () => {
    setShowPermissionGate(false)
    await startCamera()
    await startAudio()
    startSession()
    // Auto-start voice conversion if enabled and connected
    if (voiceConversionEnabled && activeProvider?.status === 'connected' && audioStream.current) {
      vc.startConversion(audioStream.current).catch(console.error)
    }
  }, [startCamera, startAudio, startSession, voiceConversionEnabled, activeProvider, vc, audioStream])

  // End session handler
  const handleEndSession = useCallback(() => {
    if (recordingStatus === 'recording') {
      toggleRecording(combinedStreamRef.current || new MediaStream())
    }
    // Stop voice conversion
    if (vc.isStreaming) {
      vc.stopConversion()
    }
    stopCamera()
    stopAudio()
    endSession()
  }, [recordingStatus, toggleRecording, stopCamera, stopAudio, endSession, vc])

  // Record handler
  const handleToggleRecording = useCallback(async () => {
    const stream = await buildCombinedStream()
    toggleRecording(stream)
  }, [buildCombinedStream, toggleRecording])

  const isSessionActive = sessionStatus === 'active'
  const isRecording = recordingStatus === 'recording'

  // ─── PERMISSION GATE (shown before session starts) ──
  if (showPermissionGate && sessionStatus === 'idle') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-md"
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <motion.div
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
              style={{ background: 'linear-gradient(135deg, oklch(0.72 0.18 265), oklch(0.6 0.15 265))' }}
              whileHover={{ scale: 1.05, rotate: 5 }}
            >
              <Radio className="w-8 h-8 text-white" />
            </motion.div>
            <h1 className="text-2xl font-bold tracking-tight">AI REALTIME STUDIO</h1>
            <p className="text-studio-muted-foreground/60 mt-2 text-sm">
              Real-time voice & video transformation
            </p>
          </div>

          {/* Start Card */}
          <div className="rounded-xl border border-studio-border/50 bg-card/80 backdrop-blur-sm p-6 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                <Video className="w-5 h-5 text-studio-accent" />
                <div>
                  <p className="text-sm font-medium">Camera Access</p>
                  <p className="text-xs text-studio-muted-foreground/60">Required for video transformation</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                <Mic className="w-5 h-5 text-studio-accent" />
                <div>
                  <p className="text-sm font-medium">Microphone Access</p>
                  <p className="text-xs text-studio-muted-foreground/60">Required for voice transformation</p>
                </div>
              </div>
            </div>

            <Button
              onClick={handleStartSession}
              className="w-full h-12 text-sm font-semibold"
              style={{ background: 'linear-gradient(135deg, oklch(0.72 0.18 265), oklch(0.6 0.15 265))' }}
            >
              <Zap className="w-4 h-4 mr-2" />
              Start Studio Session
            </Button>

            {activeProvider ? (
              <div className="flex items-center justify-center gap-2 text-xs text-studio-success">
                <div className="w-1.5 h-1.5 rounded-full bg-studio-success animate-pulse-glow" />
                Connected to {activeProvider.name}
              </div>
            ) : (
              <p className="text-center text-xs text-studio-muted-foreground/50">
                No AI provider configured -- <SettingsDialog /> to add one
              </p>
            )}
          </div>
        </motion.div>
      </div>
    )
  }

  // ─── ACTIVE STUDIO ─────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Bar */}
      <header className="h-12 border-b border-studio-border/50 flex items-center justify-between px-3 md:px-4 bg-card/50 backdrop-blur-sm shrink-0 z-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-studio-accent" />
            <span className="text-xs font-semibold tracking-wider uppercase hidden sm:inline">
              AI REALTIME STUDIO
            </span>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-1.5 text-xs text-studio-muted-foreground/70">
            <Clock className="w-3 h-3" />
            <span className="font-mono">{formatDuration(sessionDuration)}</span>
          </div>
          {isRecording && (
            <Badge
              variant="destructive"
              className="text-[10px] px-1.5 py-0 gap-1 animate-recording"
            >
              <Circle className="w-2 h-2 fill-current" />
              REC {formatDuration(recordingDuration)}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Provider Status */}
          {activeProvider && (
            <Badge
              variant="outline"
              className="text-[10px] px-2 py-0 gap-1 border-studio-success/30 text-studio-success hidden sm:flex"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-studio-success animate-pulse-glow" />
              {activeProvider.name}
            </Badge>
          )}
          {!activeProvider && (
            <Badge
              variant="outline"
              className="text-[10px] px-2 py-0 gap-1 border-studio-warning/30 text-studio-warning hidden sm:flex"
            >
              <AlertCircle className="w-2.5 h-2.5" />
              No Provider
            </Badge>
          )}
          <SettingsDialog />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* ─── Camera Preview (shared) ─── */}
        <div className="flex-1 relative bg-black flex items-center justify-center min-h-0">
          {cameraStatus === 'active' ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cn(
                'w-full h-full object-contain',
                'transition-transform duration-300',
              )}
              style={{ transform: 'scaleX(-1)' }}
            />
          ) : cameraStatus === 'requesting' ? (
            <div className="flex flex-col items-center gap-3 animate-pulse">
              <Video className="w-10 h-10 text-studio-muted-foreground/30" />
              <span className="text-sm text-studio-muted-foreground/50">Requesting camera...</span>
            </div>
          ) : cameraStatus === 'error' ? (
            <div className="flex flex-col items-center gap-3">
              <AlertCircle className="w-10 h-10 text-studio-danger" />
              <span className="text-sm text-studio-danger">Camera access denied</span>
              <Button variant="outline" size="sm" onClick={startCamera}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <VideoOff className="w-10 h-10 text-studio-muted-foreground/20" />
              <span className="text-sm text-studio-muted-foreground/40">Camera off</span>
            </div>
          )}

          {/* Floating Control Bar (overlay on camera) */}
          <div className="absolute bottom-0 left-0 right-0">
            <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-16 pb-3 px-4">
              {/* Audio Levels (shown on camera overlay) */}
              <div className="max-w-md mx-auto mb-3 space-y-1">
                <AudioLevelMeter level={audioLevels.input} label="Input" />
              </div>

              {/* Main Control Buttons */}
              <div className="flex items-center justify-center gap-3">
                {/* Camera Toggle */}
                <Button
                  variant="outline"
                  size="icon"
                  className={cn(
                    'rounded-full w-11 h-11 border-studio-border/50 bg-black/30 backdrop-blur-sm',
                    cameraStatus === 'active' && 'border-studio-accent/50 text-studio-accent'
                  )}
                  onClick={cameraStatus === 'active' ? stopCamera : startCamera}
                >
                  {cameraStatus === 'active' ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                </Button>

                {/* Mic Toggle */}
                <Button
                  variant="outline"
                  size="icon"
                  className={cn(
                    'rounded-full w-11 h-11 border-studio-border/50 bg-black/30 backdrop-blur-sm',
                    audioStatus === 'active' && !isMuted && 'border-studio-accent/50 text-studio-accent',
                    isMuted && 'border-studio-danger/50 text-studio-danger'
                  )}
                  onClick={audioStatus === 'active' ? toggleMute : startAudio}
                >
                  {audioStatus === 'active' && !isMuted ? (
                    <Mic className="w-5 h-5" />
                  ) : (
                    <MicOff className="w-5 h-5" />
                  )}
                </Button>

                {/* Record Button */}
                <Button
                  variant="outline"
                  size="icon"
                  className={cn(
                    'rounded-full w-14 h-14 border-2 bg-black/30 backdrop-blur-sm transition-all',
                    isRecording
                      ? 'border-studio-danger text-studio-danger animate-recording'
                      : 'border-studio-border/50 hover:border-studio-danger/50'
                  )}
                  onClick={handleToggleRecording}
                  disabled={!isSessionActive}
                >
                  {isRecording ? (
                    <Square className="w-5 h-5 fill-current" />
                  ) : (
                    <Circle className="w-5 h-5 fill-current" />
                  )}
                </Button>

                {/* Flip Camera (mobile only) */}
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full w-11 h-11 border-studio-border/50 bg-black/30 backdrop-blur-sm lg:hidden"
                  onClick={flipCamera}
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>

                {/* Mobile Controls Toggle */}
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-full w-11 h-11 border-studio-border/50 bg-black/30 backdrop-blur-sm lg:hidden"
                  onClick={() => setMobileControlsOpen(!isMobileControlsOpen)}
                >
                  {isMobileControlsOpen ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronUp className="w-5 h-5" />
                  )}
                </Button>

                {/* End Session */}
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full border-studio-danger/50 text-studio-danger hover:bg-studio-danger/10 bg-black/30 backdrop-blur-sm"
                  onClick={handleEndSession}
                >
                  <Square className="w-3.5 h-3.5 mr-1.5" />
                  <span className="hidden sm:inline">End</span>
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Desktop Side Panel ─── */}
        <aside className="hidden lg:flex w-80 xl:w-96 border-l border-studio-border/50 bg-card/30 flex-col overflow-hidden">
          <SidePanelContent />
        </aside>

        {/* ─── Mobile Bottom Sheet ─── */}
        <AnimatePresence>
          {isMobileControlsOpen && (
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="lg:hidden fixed inset-x-0 bottom-0 z-40 max-h-[70vh] bg-card/95 backdrop-blur-xl border-t border-studio-border/50 rounded-t-2xl"
            >
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-10 h-1 rounded-full bg-studio-border/50" />
              </div>
              <ScrollArea className="h-[calc(70vh-2rem)]">
                <div className="p-4">
                  <SidePanelContent />
                </div>
              </ScrollArea>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}

// ─── SIDE PANEL CONTENT (shared between desktop & mobile) ──
// --- SIDE PANEL CONTENT (shared between desktop & mobile) ---
function SidePanelContent() {
  const {
    activeVoicePreset, voicePresets, voicePitch, voiceConversionEnabled,
    noiseGateEnabled, noiseGateThreshold, headphonesDetected, audioStatus,
    setActiveVoicePreset, setVoicePitch, setVoiceConversionEnabled,
    setNoiseGateEnabled, setNoiseGateThreshold,
    activeProvider,
  } = useStudioStore()
  const vc = useVoiceConversion()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTimer, setRecordingTimer] = useState(0)
  const recordingTimerRef = useRef<ReturnType<typeof setInterval>>(null)

  const [activeTab, setActiveTab] = useState<'voice' | 'audio' | 'models'>('voice')

  return (
    <div className="flex flex-col h-full">
      {/* Tab Navigation */}
      <div className="flex border-b border-studio-border/50 shrink-0">
        {(['voice', 'audio', 'models'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors',
              activeTab === tab
                ? 'text-studio-accent border-b-2 border-studio-accent'
                : 'text-studio-muted-foreground/60 hover:text-studio-muted-foreground'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          {/* VOICE TAB */}
          {activeTab === 'voice' && (
            <div className="space-y-4 animate-fade-in">
              {/* Voice Conversion Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Voice Conversion</p>
                  <p className="text-xs text-studio-muted-foreground/60">Transform your voice in real-time</p>
                </div>
                <Switch
                  checked={voiceConversionEnabled}
                  onCheckedChange={setVoiceConversionEnabled}
                />
              </div>

              {voiceConversionEnabled && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-4"
                >
                  {/* Voice Presets */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-studio-muted-foreground/70">
                      Voice Presets
                    </p>
                    <div className="space-y-1.5">
                      {voicePresets.map((preset) => (
                        <VoicePresetCard
                          key={preset.id}
                          preset={preset}
                          isActive={activeVoicePreset?.id === preset.id}
                          onSelect={setActiveVoicePreset}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Pitch Slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wider text-studio-muted-foreground/70">
                        Pitch Shift
                      </p>
                      <span className="text-xs font-mono text-studio-muted-foreground/50">
                        {voicePitch > 0 ? '+' : ''}{voicePitch} st
                      </span>
                    </div>
                    <Slider
                      value={[voicePitch]}
                      onValueChange={([v]) => setVoicePitch(v)}
                      min={-12}
                      max={12}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-studio-muted-foreground/40">
                      <span>-12</span>
                      <span>0</span>
                      <span>+12</span>
                    </div>
                  </div>

                  {/* Seed-VC Reference Audio */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-studio-muted-foreground/70">
                      Reference Voice (Seed-VC)
                    </p>
                    <p className="text-[10px] text-studio-muted-foreground/50">
                      Upload or record a 1-30s clip of the target voice. Zero-shot - no training needed.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 border-studio-border/50"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5" />
                        Upload
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg,.opus"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) vc.setReferenceAudio(file)
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          'flex-1 border-studio-border/50',
                          isRecording && 'border-studio-danger text-studio-danger animate-recording'
                        )}
                        disabled={isRecording}
                        onClick={async () => {
                          try {
                            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                            setIsRecording(true)
                            setRecordingTimer(5)
                            recordingTimerRef.current = setInterval(() => {
                              setRecordingTimer(t => {
                                if (t <= 1) {
                                  clearInterval(recordingTimerRef.current!)
                                  return 0
                                }
                                return t - 1
                              })
                            }, 1000)
                            const blob = await vc.recordReference(stream, 5000)
                            stream.getTracks().forEach(t => t.stop())
                            setIsRecording(false)
                          } catch (err) {
                            console.error('Reference recording failed:', err)
                            setIsRecording(false)
                          }
                        }}
                      >
                        <Mic className="w-3.5 h-3.5 mr-1.5" />
                        {isRecording ? recordingTimer + 's' : 'Record 5s'}
                      </Button>
                    </div>
                    {vc.hasReferenceAudio && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-studio-success/10 border border-studio-success/20">
                        <Volume2 className="w-3.5 h-3.5 text-studio-success shrink-0" />
                        <span className="text-xs text-studio-success">Reference audio loaded</span>
                      </div>
                    )}
                  </div>

                  {/* Connect / Stream Controls */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wider text-studio-muted-foreground/70">
                        Seed-VC Pipeline
                      </p>
                      <span className="text-[10px] text-studio-muted-foreground/50">{vc.status}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1" onClick={() => vc.connect()} disabled={!activeProvider?.endpoint}>
                        <Link2 className="w-3.5 h-3.5 mr-1.5" />
                        Connect
                      </Button>
                      {vc.status === 'connected' && (
                        <Button size="sm" className="flex-1 bg-studio-accent hover:bg-studio-accent/80" disabled={!vc.hasReferenceAudio}>
                          <Play className="w-3.5 h-3.5 mr-1.5" />
                          Start Streaming
                        </Button>
                      )}
                      {vc.status === 'streaming' && (
                        <Button size="sm" variant="outline" className="flex-1 border-studio-danger/50 text-studio-danger" onClick={() => vc.stopConversion()}>
                          <Unplug className="w-3.5 h-3.5 mr-1.5" />
                          Stop
                        </Button>
                      )}
                    </div>
                    {vc.errorMessage && (
                      <p className="text-[10px] text-studio-danger p-2 rounded bg-studio-danger/10">{vc.errorMessage}</p>
                    )}
                    {vc.isStreaming && (
                      <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="p-2 rounded-lg bg-secondary/50">
                          <p className="text-lg font-mono text-studio-accent">{vc.latencyMs}</p>
                          <p className="text-[10px] text-studio-muted-foreground/50">Latency (ms)</p>
                        </div>
                        <div className="p-2 rounded-lg bg-secondary/50">
                          <p className="text-lg font-mono text-studio-accent">{vc.chunksProcessed}</p>
                          <p className="text-[10px] text-studio-muted-foreground/50">Chunks</p>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {/* AUDIO TAB */}
          {activeTab === 'audio' && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50">
                <div className={cn(
                  'w-2 h-2 rounded-full',
                  audioStatus === 'active' ? 'bg-studio-success animate-pulse-glow' : 'bg-studio-muted-foreground/30'
                )} />
                <span className="text-sm">
                  {audioStatus === 'active' ? 'Audio Active' : 'Audio Off'}
                </span>
              </div>
              {audioStatus === 'active' && !headphonesDetected && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-studio-warning/10 border border-studio-warning/20">
                  <Headphones className="w-4 h-4 text-studio-warning mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-studio-warning">Headphones not detected</p>
                    <p className="text-[10px] text-studio-muted-foreground/60 mt-0.5">
                      For best experience, connect headphones to prevent echo feedback.
                    </p>
                  </div>
                </div>
              )}
              {headphonesDetected && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-studio-success/10 border border-studio-success/20">
                  <MonitorSpeaker className="w-4 h-4 text-studio-success" />
                  <span className="text-xs text-studio-success">Headphones connected</span>
                </div>
              )}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Noise Gate</p>
                    <p className="text-xs text-studio-muted-foreground/60">Suppress background noise</p>
                  </div>
                  <Switch
                    checked={noiseGateEnabled}
                    onCheckedChange={setNoiseGateEnabled}
                  />
                </div>
                {noiseGateEnabled && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-studio-muted-foreground/60">Threshold</span>
                      <span className="text-xs font-mono text-studio-muted-foreground/50">
                        {noiseGateThreshold} dB
                      </span>
                    </div>
                    <Slider
                      value={[noiseGateThreshold]}
                      onValueChange={([v]) => setNoiseGateThreshold(v)}
                      min={-60}
                      max={-10}
                      step={1}
                      className="w-full"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* MODELS TAB */}
          {activeTab === 'models' && (
            <div className="space-y-4 animate-fade-in">
              <p className="text-xs text-studio-muted-foreground/60">
                Connect your Seed-VC instance (running on Colab or local GPU) via BYOK to enable real-time zero-shot voice conversion.
              </p>
              <div className="p-3 rounded-lg border border-studio-accent/20 bg-studio-accent/5 space-y-2">
                <p className="text-xs font-medium text-studio-accent">Quick Start</p>
                <ol className="text-[10px] text-studio-muted-foreground/70 space-y-1 list-decimal pl-3">
                  <li>Run Seed-VC on Colab (free T4 GPU)</li>
                  <li>Copy the Gradio URL (e.g. https://xxxxx.gradio.live)</li>
                  <li>Paste it in Settings (gear icon) as a Seed-VC provider</li>
                  <li>Upload or record a 5s reference voice clip</li>
                  <li>Hit Connect, then Start Streaming</li>
                </ol>
              </div>
              <div className="text-center text-xs text-studio-muted-foreground/40">
                Voice: Seed-VC (zero-shot) . Face: coming soon
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function SettingsDialog() {
  const { providers, setProviders, activeProvider, setActiveProvider, updateProviderStatus } = useStudioStore()
  const [name, setName] = useState('')
  const [type, setType] = useState<ProviderType>('seed-vc')
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')

  const addProvider = () => {
    if (!name || !endpoint) return
    const newProvider = {
      id: crypto.randomUUID(),
      name, type, endpoint, apiKey,
      status: 'disconnected' as const,
    }
    setProviders([...providers, newProvider])
    setName('')
    setEndpoint('')
    setApiKey('')
  }

  const testProvider = async (id: string) => {
    const provider = providers.find(p => p.id === id)
    if (!provider) return
    updateProviderStatus(id, 'connecting')
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      await fetch(provider.endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
      })
      clearTimeout(timeout)
      updateProviderStatus(id, 'connected')
    } catch {
      updateProviderStatus(id, 'error')
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="w-8 h-8">
          <Settings className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-studio-border/50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            AI Provider Settings (BYOK)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Add Provider Form */}
          <div className="space-y-3 p-3 rounded-lg border border-studio-border/30 bg-secondary/30">
            <p className="text-xs font-medium uppercase tracking-wider text-studio-muted-foreground/70">
              Add Provider
            </p>
            <div className="grid gap-2">
              <Input
                placeholder="Provider name (e.g. My RVC Server)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 text-sm"
              />
              <Select value={type} onValueChange={(v) => setType(v as ProviderType)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="seed-vc">Seed-VC (Zero-Shot VC) - Recommended</SelectItem>
                  <SelectItem value="rvc">RVC (Voice Conversion)</SelectItem>
                  <SelectItem value="openvoice">OpenVoice (Voice Clone)</SelectItem>
                  <SelectItem value="liveportrait">LivePortrait (Face)</SelectItem>
                  <SelectItem value="faceswap">Face Swap</SelectItem>
                  <SelectItem value="wav2lip">Wav2Lip (Lip Sync)</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="e.g. https://xxxxx.gradio.live"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="h-9 text-sm"
              />
              <Input
                placeholder="API Key (optional - most Seed-VC instances don't need one)"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="h-9 text-sm"
              />
              <Button onClick={addProvider} size="sm" className="w-full" disabled={!name || !endpoint}>
                Add Provider
              </Button>
            </div>
          </div>

          {/* Provider List */}
          {providers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-studio-muted-foreground/70">
                Configured Providers
              </p>
              {providers.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg border transition-colors',
                    activeProvider?.id === p.id
                      ? 'border-studio-accent/50 bg-studio-accent/5'
                      : 'border-studio-border/30 bg-secondary/30'
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      p.status === 'connected' ? 'bg-studio-success' :
                      p.status === 'connecting' ? 'bg-studio-warning animate-pulse' :
                      p.status === 'error' ? 'bg-studio-danger' :
                      'bg-studio-muted-foreground/30'
                    )} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-[10px] text-studio-muted-foreground/50 truncate">{p.type} · {p.endpoint}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => p.id && testProvider(p.id)}
                      disabled={p.status === 'connecting'}
                    >
                      Test
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        'h-7 text-xs',
                        activeProvider?.id === p.id && 'text-studio-accent'
                      )}
                      onClick={() => setActiveProvider(p)}
                    >
                      {activeProvider?.id === p.id ? 'Active' : 'Use'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {providers.length === 0 && (
            <p className="text-center text-xs text-studio-muted-foreground/40 py-4">
              No providers yet. Add your Seed-VC Gradio URL above.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
