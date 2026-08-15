'use client'

import dynamic from 'next/dynamic'

const StudioShell = dynamic(() => import('@/components/studio/StudioShell'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-4 animate-pulse">
        <div className="w-16 h-16 rounded-2xl mx-auto" style={{ background: 'linear-gradient(135deg, oklch(0.72 0.18 265), oklch(0.6 0.15 265))' }} />
        <p className="text-sm text-studio-muted-foreground/60">Loading Studio...</p>
      </div>
    </div>
  ),
})

export default function Home() {
  return <StudioShell />
}
