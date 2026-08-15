'use client'

import { Headphones, MonitorSpeaker } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { useStudioStore } from '@/stores/studio-store'
import { cn } from '@/lib/utils'

export default function AudioTab() {
  const {
    noiseGateEnabled, noiseGateThreshold, headphonesDetected, audioStatus,
    setNoiseGateEnabled, setNoiseGateThreshold,
  } = useStudioStore()

  return (
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
  )
}
