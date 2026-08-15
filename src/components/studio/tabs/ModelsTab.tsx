'use client'

export default function ModelsTab() {
  return (
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
      <div className="p-3 rounded-lg border border-studio-warning/20 bg-studio-warning/5 space-y-2">
        <p className="text-xs font-medium text-studio-warning">Face Swap Setup</p>
        <ol className="text-[10px] text-studio-muted-foreground/70 space-y-1 list-decimal pl-3">
          <li>Install git-xet: <a href="https://github.com/xetdata/xet-tools" target="_blank" rel="noopener noreferrer" className="text-studio-accent underline underline-offset-2">winget install git-xet</a></li>
          <li>Clone the space: <a href="https://huggingface.co/spaces/V0pr0S/ComfyUI-Reactor-Fast-Face-Swap-CPU" target="_blank" rel="noopener noreferrer" className="text-studio-accent underline underline-offset-2 break-all">huggingface.co/spaces/V0pr0S/ComfyUI-Reactor-Fast-Face-Swap-CPU</a></li>
          <li>Run ComfyUI locally with ReActor node installed</li>
          <li>Add a Face Swap provider in Settings pointing to http://127.0.0.1:8188</li>
          <li>Upload or capture a reference face, then Start Swap</li>
        </ol>
      </div>
      <div className="text-center text-xs text-studio-muted-foreground/40">
        Voice: Seed-VC (zero-shot) | Face: ComfyUI ReActor
      </div>
    </div>
  )
}