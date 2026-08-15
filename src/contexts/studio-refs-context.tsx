'use client'

import { createContext, useContext, type RefObject } from 'react'

interface StudioRefs {
  videoRef: RefObject<HTMLVideoElement | null>
  faceSwapCanvasRef: RefObject<HTMLCanvasElement | null>
}

export const StudioRefsContext = createContext<StudioRefs | null>(null)

export function useStudioRefs(): StudioRefs {
  const ctx = useContext(StudioRefsContext)
  if (!ctx) {
    throw new Error('useStudioRefs must be used inside StudioRefsContext.Provider')
  }
  return ctx
}
