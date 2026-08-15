'use client'

import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Mic, Upload, Volume2, Link2, Unplug, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useVoiceConversion } from '@/hooks/use-voice-conversion'
import { useStudioStore, type VoicePreset, type ProviderType } from '@/stores/studio-store'
import { cn } from '@/lib/utils'

const voiceIcons: Record<ProviderType, string> = {
  'seed-vc': '\u{1F33F}',
  rvc: '\u{1F399}\uFE0F',
  openvoice: '\u{1F9EC}',
  liveportrait: '\u{1F3AD}',
  wav2lip: '\u{1F444}',
  faceswap: '\u{1F464}',
  custom: '\u2699\uFE0F',
}

// AUDIO LEVEL METER
export function AudioLevelMeter({ level, label }: { level: number; label: string }) {
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

// VOICE PRESET CARD
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

// VOICE TAB
export default function VoiceTab() {
  const {
    activeVoicePreset, voicePresets, voicePitch, voiceConversionEnabled,
    activeProvider,
    setActiveVoicePreset, setVoicePitch, setVoiceConversionEnabled,
  } = useStudioStore()
  const vc = useVoiceConversion()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTimer, setRecordingTimer] = useState(0)
  const recordingTimerRef = useRef<ReturnType<typeof setInterval>>(null)

  return (
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
                <Button size="sm" className="flex-1 bg-studio-accent hover:bg-studio-accent/80" disabled={!vc.hasReferenceAudio} onClick={async () => {
                  try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 48000, echoCancellation: true } })
                    await vc.startConversion(stream)
                  } catch (err) {
                    console.error('Failed to start streaming:', err)
                  }
                }}>
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
  )
}
