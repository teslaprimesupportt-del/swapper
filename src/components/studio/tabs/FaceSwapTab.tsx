'use client'

import { useRef } from 'react'
import { motion } from 'framer-motion'
import {
  Upload, Camera, Trash2, Play, Square, Link2, Unplug, User, Settings, AlertCircle
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import { useFaceSwap } from '@/hooks/use-face-swap'
import { useStudioRefs } from '@/contexts/studio-refs-context'
import { useStudioStore, type FaceSwapFps } from '@/stores/studio-store'
import { cn } from '@/lib/utils'

export default function FaceSwapTab() {
  const {
    faceSwap,
    activeFaceProvider,
    setFaceSwapEnabled,
    setFaceSwapFps,
    setActiveFaceProvider,
    setSettingsOpen,
    providers,
  } = useStudioStore()
  const fs = useFaceSwap()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { videoRef, faceSwapCanvasRef } = useStudioRefs()

  // Only consider REAL user-configured faceswap providers (not sandbox)
  const userFaceswapProviders = providers.filter(p => p.type === 'faceswap' && p.id !== 'sandbox-faceswap')
  const faceswapProvider = userFaceswapProviders[0] || null
  const faceProvider = activeFaceProvider || faceswapProvider

  // Derive a clear status label for the UI
  const pipelineLabel =
    faceSwap.status === 'active'
      ? 'swapping'
      : fs.connectionStatus === 'connecting'
        ? 'connecting...'
        : fs.connectionStatus === 'connected'
          ? 'connected'
          : fs.connectionStatus === 'error'
            ? 'error'
            : 'off'

  const noProviderConfigured = !faceswapProvider && !activeFaceProvider

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Face Swap Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Face Swap</p>
          <p className="text-xs text-studio-muted-foreground/60">
            Real-time face swap via ComfyUI ReActor
          </p>
        </div>
        <Switch
          checked={faceSwap.faceSwapEnabled}
          onCheckedChange={setFaceSwapEnabled}
        />
      </div>

      {faceSwap.faceSwapEnabled && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="space-y-4"
        >
          {/* No Provider Warning */}
          {noProviderConfigured && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-studio-warning/10 border border-studio-warning/20">
              <AlertCircle className="w-4 h-4 text-studio-warning mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-xs font-medium text-studio-warning">No ComfyUI provider</p>
                <p className="text-[10px] text-studio-muted-foreground/60">
                  Add a Face Swap (ComfyUI ReActor) provider in Settings first.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 mt-1 border-studio-warning/30 text-studio-warning"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings className="w-3 h-3 mr-1" />
                  Open Settings
                </Button>
              </div>
            </div>
          )}

          {/* Reference Face Section */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-studio-muted-foreground/70">
              Reference Face
            </p>
            <p className="text-[10px] text-studio-muted-foreground/50">
              Upload a photo or capture a frame from your webcam as the target face.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 border-studio-border/50"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                Upload Image
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) fs.setReferenceFromFile(file)
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="flex-1 border-studio-border/50"
                onClick={() => {
                  const video = videoRef.current
                  if (video && video.readyState >= 2) fs.setReferenceFromVideo(video)
                }}
              >
                <Camera className="w-3.5 h-3.5 mr-1.5" />
                Capture
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-studio-border/50 text-studio-danger hover:text-studio-danger hover:bg-studio-danger/10"
                onClick={() => fs.clearReference()}
                disabled={!fs.hasReferenceFace}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Reference Face Preview */}
            {fs.referenceFacePreview && (
              <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-studio-border/50 bg-secondary/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fs.referenceFacePreview}
                  alt="Reference face"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <User className="w-5 h-5 text-studio-accent" />
                </div>
              </div>
            )}

            {fs.hasReferenceFace && !fs.referenceFacePreview && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-studio-success/10 border border-studio-success/20">
                <User className="w-3.5 h-3.5 text-studio-success shrink-0" />
                <span className="text-xs text-studio-success">Reference face loaded</span>
              </div>
            )}
          </div>

          {/* Connect / Swap Controls */}
          {!noProviderConfigured && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-studio-muted-foreground/70">
                  ComfyUI Pipeline
                </p>
                <div className="flex items-center gap-1.5">
                  <div className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    pipelineLabel === 'connected' || pipelineLabel === 'swapping'
                      ? 'bg-studio-success'
                      : pipelineLabel === 'error'
                        ? 'bg-studio-danger'
                        : pipelineLabel === 'connecting...'
                          ? 'bg-studio-warning animate-pulse'
                          : 'bg-studio-muted-foreground/30'
                  )} />
                  <span className="text-[10px] text-studio-muted-foreground/50">
                    {pipelineLabel}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                {fs.connectionStatus !== 'connected' && fs.connectionStatus !== 'connecting' && (
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={async () => {
                      if (!activeFaceProvider && faceProvider) {
                        setActiveFaceProvider(faceProvider)
                      }
                      setTimeout(() => fs.connect(), 50)
                    }}
                  >
                    <Link2 className="w-3.5 h-3.5 mr-1.5" />
                    {fs.connectionStatus === 'error' ? 'Retry Connect' : 'Connect'}
                  </Button>
                )}
                {fs.connectionStatus === 'connecting' && (
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled
                  >
                    <Link2 className="w-3.5 h-3.5 mr-1.5 animate-pulse" />
                    Connecting...
                  </Button>
                )}
                {fs.connectionStatus === 'connected' && faceSwap.status !== 'active' && (
                  <Button
                    size="sm"
                    className="flex-1 bg-studio-accent hover:bg-studio-accent/80"
                    disabled={!fs.hasReferenceFace}
                    onClick={() => {
                      const video = videoRef.current
                      const canvas = faceSwapCanvasRef.current
                      if (video && canvas) {
                        fs.startSwap(video, canvas)
                      }
                    }}
                  >
                    <Play className="w-3.5 h-3.5 mr-1.5" />
                    Start Swap
                  </Button>
                )}
                {faceSwap.status === 'active' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-studio-danger/50 text-studio-danger"
                    onClick={() => fs.stopSwap()}
                  >
                    <Square className="w-3.5 h-3.5 mr-1.5" />
                    Stop Swap
                  </Button>
                )}
                {fs.connectionStatus === 'connected' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-studio-border/50 text-studio-muted-foreground/70"
                    onClick={() => fs.disconnect()}
                  >
                    <Unplug className="w-3.5 h-3.5 mr-1.5" />
                  </Button>
                )}
              </div>
              {fs.errorMessage && (
                <p className="text-[10px] text-studio-danger p-2 rounded bg-studio-danger/10">
                  {fs.errorMessage}
                </p>
              )}
            </div>
          )}

          {/* FPS Selector */}
          {!noProviderConfigured && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-studio-muted-foreground/70">
                  Target FPS
                </p>
              </div>
              <Select
                value={String(faceSwap.fps)}
                onValueChange={(v) => setFaceSwapFps(Number(v) as FaceSwapFps)}
              >
                <SelectTrigger className="h-9 text-sm border-studio-border/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 FPS (low power)</SelectItem>
                  <SelectItem value="2">2 FPS</SelectItem>
                  <SelectItem value="3">3 FPS (balanced)</SelectItem>
                  <SelectItem value="5">5 FPS (high quality GPU)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Stats Grid */}
          {faceSwap.status === 'active' && (
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="p-2 rounded-lg bg-secondary/50">
                <p className="text-lg font-mono text-studio-accent">{faceSwap.latencyMs}</p>
                <p className="text-[10px] text-studio-muted-foreground/50">Latency (ms)</p>
              </div>
              <div className="p-2 rounded-lg bg-secondary/50">
                <p className="text-lg font-mono text-studio-accent">{faceSwap.framesProcessed}</p>
                <p className="text-[10px] text-studio-muted-foreground/50">Frames</p>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
