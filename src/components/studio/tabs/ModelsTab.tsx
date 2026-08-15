'use client'

export default function ModelsTab() {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="p-3 rounded-lg border border-studio-accent/20 bg-studio-accent/5 space-y-2">
        <p className="text-xs font-medium text-studio-accent">One-Click Setup (Colab — Free GPU)</p>
        <p className="text-[10px] text-studio-muted-foreground/70">
          Open the Colab notebook below, hit &quot;Run all&quot;, and paste the two URLs into Settings.
        </p>
        <a
          href="https://colab.research.google.com/github/teslaprimesupportt-del/swapper/blob/main/scripts/studio-colab.ipynb"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 mt-1 px-3 py-1.5 rounded-md bg-studio-accent/10 border border-studio-accent/30 text-studio-accent text-[11px] font-medium hover:bg-studio-accent/20 transition-colors"
        >
          Open Colab Notebook
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" /></svg>
        </a>
        <ol className="text-[10px] text-studio-muted-foreground/70 space-y-1 list-decimal pl-3 pt-1">
          <li>Open notebook → Runtime → Change runtime type → <strong>T4 GPU</strong></li>
          <li>Run all cells (~5 min install, then servers start)</li>
          <li>Copy the <strong>Face Swap URL</strong> (trycloudflare.com) → Settings → Add Provider → type: <code className="text-studio-accent">faceswap</code></li>
          <li>Copy the <strong>Voice URL</strong> (gradio.live) → Settings → Add Provider → type: <code className="text-studio-accent">seed-vc</code></li>
          <li>Back in Studio: upload a face + record voice, then hit Connect / Start</li>
        </ol>
      </div>

      <div className="p-3 rounded-lg border border-studio-border/30 bg-secondary/30 space-y-2">
        <p className="text-xs font-medium text-studio-muted-foreground">Voice Change</p>
        <ol className="text-[10px] text-studio-muted-foreground/70 space-y-1 list-decimal pl-3">
          <li>Connect your Seed-VC provider (from Colab above)</li>
          <li>Upload or record a 5s reference voice clip in the Voice tab</li>
          <li>Hit Connect, then Start Streaming</li>
        </ol>
      </div>

      <div className="p-3 rounded-lg border border-studio-border/30 bg-secondary/30 space-y-2">
        <p className="text-xs font-medium text-studio-muted-foreground">Face Swap</p>
        <ol className="text-[10px] text-studio-muted-foreground/70 space-y-1 list-decimal pl-3">
          <li>Connect your ComfyUI provider (from Colab above)</li>
          <li>Upload or capture a reference face in the Face tab</li>
          <li>Hit Connect, then Start Swap</li>
        </ol>
      </div>

      <div className="text-center text-xs text-studio-muted-foreground/40">
        Voice: Seed-VC (zero-shot) | Face: ComfyUI ReActor
      </div>
    </div>
  )
}
