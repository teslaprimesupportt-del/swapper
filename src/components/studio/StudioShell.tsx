'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Video, VideoOff, Mic, MicOff, Settings, Circle, Square,
  RotateCcw, ChevronUp, ChevronDown, X, PanelRightClose, PanelRightOpen,
  Radio, Clock, Zap, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { useFaceSwap } from '@/hooks/use-face-swap'
import { useStudioStore, type ProviderType } from '@/stores/studio-store'
import { cn } from '@/lib/utils'
import { AudioLevelMeter } from '@/components/studio/tabs/VoiceTab'
import VoiceTab from '@/components/studio/tabs/VoiceTab'
import AudioTab from '@/components/studio/tabs/AudioTab'
import FaceSwapTab from '@/components/studio/tabs/FaceSwapTab'
import ModelsTab from '@/components/studio/tabs/ModelsTab'
import { StudioRefsContext } from '@/contexts/studio-refs-context'

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

// ─── MAIN STUDIO COMPONENT ───────────────────────
export default function StudioShell() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const faceSwapCanvasRef = useRef<HTMLCanvasElement>(null)
  const combinedStreamRef = useRef<MediaStream | null>(null)
  const [showPermissionGate, setShowPermissionGate] = useState(true)

  const {
    cameraStatus, audioStatus, sessionStatus, sessionDuration,
    recordingStatus, recordingDuration,
    audioLevels, isMuted,
    activeProvider, activeFaceProvider, voiceConversionEnabled,
    faceSwap, isMobileControlsOpen, sidePanelOpen,
    startSession, endSession,
    setMobileControlsOpen, setSidePanelOpen,
  } = useStudioStore()

  const { startCamera, stopCamera, flipCamera } = useCamera(videoRef)
  const { startAudio, stopAudio, toggleMute, audioStream } = useAudio()
  const { toggleRecording } = useRecording()
  const vc = useVoiceConversion()
  const fs = useFaceSwap()
  useSessionTimer()

  // Listen for voice conversion start requests from VoiceTab
  // This passes the session's existing mic stream instead of creating a second getUserMedia
  useEffect(() => {
    const handleStartVC = async () => {
      if (audioStream.current && vc.status === 'connected' && !vc.isStreaming) {
        try {
          await vc.startConversion(audioStream.current)
        } catch (err) {
          console.error('Failed to start voice conversion:', err)
        }
      }
    }
    window.addEventListener('studio:start-voice-conversion', handleStartVC)
    return () => window.removeEventListener('studio:start-voice-conversion', handleStartVC)
  }, [vc, audioStream])

  // Build combined stream for recording
  const buildCombinedStream = useCallback(async () => {
    const tracks: MediaStreamTrack[] = []
    // When face swap is active, capture the canvas (with swapped faces) instead of raw video
    if (
      faceSwap.faceSwapEnabled &&
      faceSwap.status === 'active' &&
      faceSwapCanvasRef.current
    ) {
      const canvasStream = faceSwapCanvasRef.current.captureStream(30)
      tracks.push(...canvasStream.getVideoTracks())
    } else if (videoRef.current?.srcObject) {
      const vidStream = videoRef.current.srcObject as MediaStream
      tracks.push(...vidStream.getVideoTracks())
    }
    combinedStreamRef.current = new MediaStream(tracks)
    return combinedStreamRef.current
  }, [faceSwap.faceSwapEnabled, faceSwap.status])

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
    // Auto-start face swap if enabled, connected, and references are ready
    if (
      faceSwap.faceSwapEnabled &&
      activeFaceProvider?.status === 'connected' &&
      videoRef.current &&
      faceSwapCanvasRef.current
    ) {
      fs.startSwap(videoRef.current, faceSwapCanvasRef.current)
    }
  }, [startCamera, startAudio, startSession, voiceConversionEnabled, activeProvider, vc, audioStream, faceSwap.faceSwapEnabled, activeFaceProvider, fs])

  // End session handler
  const handleEndSession = useCallback(() => {
    if (recordingStatus === 'recording') {
      toggleRecording(combinedStreamRef.current || new MediaStream())
    }
    // Stop voice conversion
    if (vc.isStreaming) {
      vc.stopConversion()
    }
    // Stop face swap
    fs.stopSwap()
    stopCamera()
    stopAudio()
    endSession()
  }, [recordingStatus, toggleRecording, stopCamera, stopAudio, endSession, vc, fs])

  // Record handler
  const handleToggleRecording = useCallback(async () => {
    const stream = await buildCombinedStream()
    toggleRecording(stream)
  }, [buildCombinedStream, toggleRecording])

  const isSessionActive = sessionStatus === 'active'
  const isRecording = recordingStatus === 'recording'

  // ─── PERMISSION GATE (shown before session starts) ───
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
                No AI provider configured -- open Settings to add one
              </p>
            )}
          </div>
        </motion.div>
      </div>
    )
  }

  // ─── ACTIVE STUDIO ───────────────────────────
  const refsValue = { videoRef, faceSwapCanvasRef }

  return (
    <StudioRefsContext.Provider value={refsValue}>
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
          {activeFaceProvider && (
            <Badge
              variant="outline"
              className="text-[10px] px-2 py-0 gap-1 border-studio-warning/30 text-studio-warning hidden sm:flex"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-studio-warning animate-pulse-glow" />
              {activeFaceProvider.name}
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
            <>
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
              {/* Face Swap Canvas Overlay */}
              <canvas
                ref={faceSwapCanvasRef}
                className={cn(
                  'absolute inset-0 w-full h-full object-contain',
                  'transition-opacity duration-300',
                  faceSwap.faceSwapEnabled && faceSwap.status === 'active'
                    ? 'opacity-100 z-10'
                    : 'opacity-0 z-0 pointer-events-none'
                )}
              />
            </>
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
        <AnimatePresence>
          {sidePanelOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="hidden lg:flex flex-col overflow-hidden border-l border-studio-border/50 bg-card/30"
            >
              <div className="w-80 xl:w-96 flex flex-col h-full">
                <div className="flex items-center justify-end px-2 py-1.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7"
                    onClick={() => setSidePanelOpen(false)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <SidePanelContent />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Desktop sidebar reopen button (shown when closed) */}
        {!sidePanelOpen && (
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:flex absolute right-2 top-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-card/80 border border-studio-border/50 backdrop-blur-sm"
            onClick={() => setSidePanelOpen(true)}
          >
            <PanelRightOpen className="w-4 h-4" />
          </Button>
        )}

        {/* ─── Mobile Bottom Sheet ─── */}
        <AnimatePresence>
          {isMobileControlsOpen && (
            <>
              {/* Backdrop — tap to dismiss */}
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-30 bg-black/40 lg:hidden"
                onClick={() => setMobileControlsOpen(false)}
              />
              <motion.div
                key="sheet"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="lg:hidden fixed inset-x-0 bottom-0 z-40 max-h-[70vh] bg-card/95 backdrop-blur-xl border-t border-studio-border/50 rounded-t-2xl"
              >
                <div className="flex items-center justify-between px-3 pt-2 pb-1">
                  <button
                    onClick={() => setMobileControlsOpen(false)}
                    className="flex justify-center flex-1"
                    aria-label="Close panel"
                  >
                    <div className="w-10 h-1 rounded-full bg-studio-border/50" />
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7 -mr-1"
                    onClick={() => setMobileControlsOpen(false)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <ScrollArea className="h-[calc(70vh-2.5rem)]">
                  <div className="p-4">
                    <SidePanelContent />
                  </div>
                </ScrollArea>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </main>
    </div>
    </StudioRefsContext.Provider>
  )
}

// ─── SIDE PANEL CONTENT (shared between desktop & mobile) ──
function SidePanelContent() {
  const [activeTab, setActiveTab] = useState<'voice' | 'face' | 'audio' | 'models'>('voice')

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'voice', label: 'Voice' },
    { key: 'face', label: 'Face' },
    { key: 'audio', label: 'Audio' },
    { key: 'models', label: 'Models' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Tab Navigation */}
      <div className="flex border-b border-studio-border/50 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex-1 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors',
              activeTab === tab.key
                ? 'text-studio-accent border-b-2 border-studio-accent'
                : 'text-studio-muted-foreground/60 hover:text-studio-muted-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          {activeTab === 'voice' && <VoiceTab />}
          {activeTab === 'face' && <FaceSwapTab />}
          {activeTab === 'audio' && <AudioTab />}
          {activeTab === 'models' && <ModelsTab />}
        </div>
      </ScrollArea>
    </div>
  )
}

function SettingsDialog() {
  const { providers, setProviders, activeProvider, activeFaceProvider, setActiveProvider, setActiveFaceProvider, updateProviderStatus, isSettingsOpen, setSettingsOpen } = useStudioStore()
  const [name, setName] = useState('')
  const [type, setType] = useState<ProviderType>('seed-vc')
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [faceRestoreModel, setFaceRestoreModel] = useState('GFPGANv1.4')
  const [faceDetectionModel, setFaceDetectionModel] = useState('retinaface_resnet50')
  const [editingId, setEditingId] = useState<string | null>(null)

  const resetForm = () => {
    setName('')
    setType('seed-vc')
    setEndpoint('')
    setApiKey('')
    setFaceRestoreModel('GFPGANv1.4')
    setFaceDetectionModel('retinaface_resnet50')
    setEditingId(null)
  }

  const addOrUpdateProvider = () => {
    if (!name || !endpoint) return
    if (editingId) {
      setProviders(providers.map(p =>
        p.id === editingId ? { ...p, name, type, endpoint, apiKey, faceRestoreModel: type === 'faceswap' ? faceRestoreModel : undefined, faceDetectionModel: type === 'faceswap' ? faceDetectionModel : undefined } : p
      ))
    } else {
      const newProvider = {
        id: crypto.randomUUID(),
        name, type, endpoint, apiKey,
        status: 'disconnected' as const,
        ...(type === 'faceswap' ? { faceRestoreModel, faceDetectionModel } : {}),
      }
      setProviders([...providers, newProvider])
    }
    resetForm()
  }

  const editProvider = (id: string) => {
    const p = providers.find(x => x.id === id)
    if (!p) return
    setEditingId(id)
    setName(p.name)
    setType(p.type)
    setEndpoint(p.endpoint)
    setApiKey(p.apiKey)
    setFaceRestoreModel(p.faceRestoreModel || 'GFPGANv1.4')
    setFaceDetectionModel(p.faceDetectionModel || 'retinaface_resnet50')
  }

  const deleteProvider = (id: string) => {
    setProviders(providers.filter(p => p.id !== id))
    if (activeProvider?.id === id) setActiveProvider(null)
    if (activeFaceProvider?.id === id) setActiveFaceProvider(null)
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

  const typeHint = type === 'faceswap'
    ? 'Point to a ComfyUI instance with ReActor installed (e.g. https://xxx.trycloudflare.com or http://127.0.0.1:8188)'
    : type === 'seed-vc'
      ? 'Point to a Seed-VC Gradio instance (e.g. https://xxxxx.gradio.live)'
      : 'Enter the API endpoint URL for this provider'

  return (
    <Dialog open={isSettingsOpen} onOpenChange={(open) => setSettingsOpen(open)}>
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
          {/* Add / Edit Provider Form */}
          <div className="space-y-3 p-3 rounded-lg border border-studio-border/30 bg-secondary/30">
            <p className="text-xs font-medium uppercase tracking-wider text-studio-muted-foreground/70">
              {editingId ? 'Edit Provider' : 'Add Provider'}
            </p>
            <div className="grid gap-2">
              <Input
                placeholder="Provider name (e.g. My Seed-VC Server)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 text-sm"
              />
              <Select value={type} onValueChange={(v) => setType(v as ProviderType)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="seed-vc">Seed-VC (Zero-Shot VC) - Voice</SelectItem>
                  <SelectItem value="rvc">RVC (Voice Conversion)</SelectItem>
                  <SelectItem value="openvoice">OpenVoice (Voice Clone)</SelectItem>
                  <SelectItem value="liveportrait">LivePortrait (Face)</SelectItem>
                  <SelectItem value="faceswap">Face Swap (ComfyUI ReActor) - Face</SelectItem>
                  <SelectItem value="wav2lip">Wav2Lip (Lip Sync)</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder={typeHint}
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="h-9 text-sm"
              />
              <Input
                placeholder="API Key (optional - most instances don't need one)"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="h-9 text-sm"
              />
              {type === 'faceswap' && (
                <div className="space-y-2">
                  <p className="text-[10px] text-studio-muted-foreground/60">
                    ComfyUI with ReActor node. Use the Colab notebook to set up a free GPU instance.
                  </p>
                  <p className="text-[10px] text-studio-muted-foreground/50">
                    API: POST /prompt → GET /history/:id → GET /view?filename=X
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <p className="text-[10px] text-studio-muted-foreground/60">Face Restore</p>
                      <Select value={faceRestoreModel} onValueChange={setFaceRestoreModel}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GFPGANv1.4">GFPGAN v1.4</SelectItem>
                          <SelectItem value="GFPGANv1.3">GFPGAN v1.3</SelectItem>
                          <SelectItem value="codeformer">CodeFormer</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-studio-muted-foreground/60">Detection Model</p>
                      <Select value={faceDetectionModel} onValueChange={setFaceDetectionModel}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="retinaface_resnet50">RetinaFace ResNet50</SelectItem>
                          <SelectItem value="retinaface_mobile0.25">RetinaFace Mobile (fast)</SelectItem>
                          <SelectItem value="opencv">OpenCV (fastest)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}
              {type === 'seed-vc' && (
                <div className="space-y-1">
                  <p className="text-[10px] text-studio-muted-foreground/60">
                    Seed-VC zero-shot voice conversion. No training needed — upload a 1-30s reference clip.
                  </p>
                  <p className="text-[10px] text-studio-muted-foreground/50">
                    API: GET /info → POST /call/fn_name → GET /call/fn_name/event_id
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={addOrUpdateProvider} size="sm" className="flex-1" disabled={!name || !endpoint}>
                  {editingId ? 'Save Changes' : 'Add Provider'}
                </Button>
                {editingId && (
                  <Button onClick={resetForm} variant="outline" size="sm" className="border-studio-border/50">
                    Cancel
                  </Button>
                )}
              </div>
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
                    (activeProvider?.id === p.id || activeFaceProvider?.id === p.id)
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
                      <p className="text-sm font-medium truncate">
                        {p.name}
                        {p.type === 'faceswap' && ' (Face)'}
                        {p.type === 'seed-vc' && ' (Voice)'}
                      </p>
                      <p className="text-[10px] text-studio-muted-foreground/50 truncate">{p.endpoint}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
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
                      className="h-7 text-xs"
                      onClick={() => p.id && editProvider(p.id)}
                    >
                      Edit
                    </Button>
                    {p.type === 'faceswap' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          'h-7 text-xs',
                          activeFaceProvider?.id === p.id && 'text-studio-accent'
                        )}
                        onClick={() => setActiveFaceProvider(p)}
                      >
                        {activeFaceProvider?.id === p.id ? 'Active' : 'Use'}
                      </Button>
                    ) : (
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
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-studio-danger hover:text-studio-danger"
                      onClick={() => p.id && deleteProvider(p.id)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {providers.length === 0 && (
            <p className="text-center text-xs text-studio-muted-foreground/40 py-4">
              No providers yet. Add your Seed-VC Gradio URL or ComfyUI endpoint above.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
