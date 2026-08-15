'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStudioStore, type ConnectionStatus, type FaceSwapFps } from '@/stores/studio-store'
import {
  ComfyUIFaceSwapAdapter,
  createFaceSwapAdapter,
  type FaceSwapAdapterState,
} from '@/services/comfyui-face-swap-adapter'

/**
 * Return type for the useFaceSwap hook.
 */
export interface UseFaceSwapReturn {
  // Connection
  connectionStatus: ConnectionStatus
  connect: () => Promise<void>
  disconnect: () => void
  testConnection: () => Promise<{ success: boolean; latency: number; info?: string }>

  // Reference Face
  hasReferenceFace: boolean
  referenceFacePreview: string | null
  setReferenceFace: (input: string | File | Blob) => Promise<void>
  setReferenceFromVideo: (video: HTMLVideoElement) => void
  setReferenceFromFile: (file: File) => Promise<void>
  clearReference: () => void

  // Face Swap Pipeline
  isSwapping: boolean
  latency: number
  framesProcessed: number
  errorMessage: string | null
  startSwap: (videoElement: HTMLVideoElement, canvasElement: HTMLCanvasElement) => void
  stopSwap: () => void

  // Config
  setFps: (fps: FaceSwapFps) => void
  getFps: () => FaceSwapFps

  // State
  getState: () => FaceSwapAdapterState
}

/**
 * Convert a File/Blob to a data URL.
 */
function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * useFaceSwap — React hook for ComfyUI ReActor face swap.
 *
 * Captures frames from a <video> element at the configured FPS,
 * sends each frame to the ComfyUI adapter for face swapping,
 * and draws the result onto a <canvas> element overlaid on the video.
 *
 * Reference face is buffered locally so the user can upload before
 * connecting to ComfyUI. The buffered face is pushed to the adapter
 * as soon as one is created.
 */
export function useFaceSwap(): UseFaceSwapReturn {
  const adapterRef = useRef<ComfyUIFaceSwapAdapter | null>(null)
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isRunningRef = useRef(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const processingRef = useRef(false)
  // Buffer the reference face locally — works even before adapter exists
  const bufferedRefFaceRef = useRef<string | null>(null)

  const [adapterState, setAdapterState] = useState<FaceSwapAdapterState>({
    status: 'disconnected',
    latency: 0,
    errorMessage: null,
    framesProcessed: 0,
    hasReferenceFace: false,
    referenceFaceDataUrl: null,
    queueSize: 0,
  })

  // Studio store bindings
  const activeFaceProvider = useStudioStore((s) => s.activeFaceProvider)
  const faceSwap = useStudioStore((s) => s.faceSwap)
  const updateProviderStatus = useStudioStore((s) => s.updateProviderStatus)
  const setFaceSwapStatus = useStudioStore((s) => s.setFaceSwapStatus)
  const setFaceSwapLatency = useStudioStore((s) => s.setFaceSwapLatency)
  const setFaceSwapFramesProcessed = useStudioStore((s) => s.setFaceSwapFramesProcessed)
  const setFaceSwapError = useStudioStore((s) => s.setFaceSwapError)
  const setFaceSwapHasReferenceFace = useStudioStore((s) => s.setFaceSwapHasReferenceFace)
  const setFaceSwapFps = useStudioStore((s) => s.setFaceSwapFps)

  // Map adapter status to ConnectionStatus
  const connectionStatus: ConnectionStatus =
    adapterState.status === 'connected' || adapterState.status === 'swapping'
      ? 'connected'
      : adapterState.status === 'connecting'
        ? 'connecting'
        : adapterState.status === 'error'
          ? 'error'
          : 'disconnected'

  // Derive hasReferenceFace from local buffer OR adapter state
  const hasReferenceFace = adapterState.hasReferenceFace || bufferedRefFaceRef.current !== null
  const referenceFacePreview = adapterState.referenceFaceDataUrl || bufferedRefFaceRef.current

  /**
   * Get or create the adapter from the active face provider.
   * If we have a buffered reference face, push it to the new adapter.
   */
  const getAdapter = useCallback((): ComfyUIFaceSwapAdapter | null => {
    if (!activeFaceProvider?.endpoint) return null

    // Recreate if endpoint changed
    if (
      adapterRef.current &&
      adapterRef.current.getConfig().endpoint !== activeFaceProvider.endpoint
    ) {
      adapterRef.current.disconnect()
      adapterRef.current = null
    }

    if (!adapterRef.current) {
      adapterRef.current = createFaceSwapAdapter(activeFaceProvider)
      adapterRef.current.onStateChange((partial) => {
        setAdapterState((prev) => ({ ...prev, ...partial }))
        if (partial.latency !== undefined) setFaceSwapLatency(partial.latency)
        if (partial.framesProcessed !== undefined) setFaceSwapFramesProcessed(partial.framesProcessed)
        if (partial.errorMessage !== undefined) setFaceSwapError(partial.errorMessage)
        if (partial.hasReferenceFace !== undefined) setFaceSwapHasReferenceFace(partial.hasReferenceFace)
      })

      // Push buffered reference face to the newly created adapter
      if (bufferedRefFaceRef.current) {
        adapterRef.current.setReferenceFace(bufferedRefFaceRef.current)
      }
    }

    return adapterRef.current
  }, [activeFaceProvider, setFaceSwapLatency, setFaceSwapFramesProcessed, setFaceSwapError, setFaceSwapHasReferenceFace])

  /**
   * Connect to the ComfyUI instance.
   */
  const connect = useCallback(async () => {
    const adapter = getAdapter()
    if (!adapter) return

    try {
      await adapter.connect()
      if (activeFaceProvider?.id) {
        updateProviderStatus(activeFaceProvider.id, 'connected')
      }
    } catch {
      if (activeFaceProvider?.id) {
        updateProviderStatus(activeFaceProvider.id, 'error')
      }
    }
  }, [getAdapter, activeFaceProvider, updateProviderStatus])

  /**
   * Disconnect from ComfyUI.
   */
  const disconnect = useCallback(() => {
    stopSwap()
    adapterRef.current?.disconnect()
    if (activeFaceProvider?.id) {
      updateProviderStatus(activeFaceProvider.id, 'disconnected')
    }
  }, [activeFaceProvider, updateProviderStatus])

  /**
   * Test the ComfyUI connection.
   */
  const testConnection = useCallback(async () => {
    const adapter = getAdapter()
    if (!adapter) return { success: false, latency: 0, info: 'No face provider configured' }
    return adapter.testConnection()
  }, [getAdapter])

  /**
   * Set reference face from a data URL, File, or Blob.
   * Buffers locally AND pushes to adapter if one exists.
   */
  const setReferenceFace = useCallback(async (input: string | File | Blob) => {
    let dataUrl: string
    if (typeof input === 'string') {
      dataUrl = input
    } else {
      dataUrl = await fileToDataUrl(input)
    }

    // Buffer locally (works before adapter exists)
    bufferedRefFaceRef.current = dataUrl
    setAdapterState((prev) => ({
      ...prev,
      hasReferenceFace: true,
      referenceFaceDataUrl: dataUrl,
    }))
    setFaceSwapHasReferenceFace(true)

    // Also push to adapter if it exists
    if (adapterRef.current) {
      await adapterRef.current.setReferenceFace(dataUrl)
    }
  }, [setFaceSwapHasReferenceFace])

  /**
   * Capture reference face from a video element (current frame).
   */
  const setReferenceFromVideo = useCallback((video: HTMLVideoElement) => {
    const canvas = document.createElement('canvas')
    const size = Math.min(video.videoWidth, video.videoHeight)
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const sx = (video.videoWidth - size) / 2
    const sy = (video.videoHeight - size) / 2
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size)
    const dataUrl = canvas.toDataURL('image/png')

    // Buffer locally
    bufferedRefFaceRef.current = dataUrl
    setAdapterState((prev) => ({
      ...prev,
      hasReferenceFace: true,
      referenceFaceDataUrl: dataUrl,
    }))
    setFaceSwapHasReferenceFace(true)

    // Push to adapter if it exists
    if (adapterRef.current) {
      adapterRef.current.setReferenceFace(dataUrl)
    }
  }, [setFaceSwapHasReferenceFace])

  /**
   * Load reference face from a file.
   */
  const setReferenceFromFile = useCallback(async (file: File) => {
    await setReferenceFace(file)
  }, [setReferenceFace])

  /**
   * Clear the reference face.
   */
  const clearReference = useCallback(() => {
    bufferedRefFaceRef.current = null
    adapterRef.current?.clearReferenceFace()
    setAdapterState((prev) => ({
      ...prev,
      hasReferenceFace: false,
      referenceFaceDataUrl: null,
    }))
    setFaceSwapHasReferenceFace(false)
  }, [setFaceSwapHasReferenceFace])

  /**
   * Start the face swap pipeline.
   */
  const startSwap = useCallback(
    (videoElement: HTMLVideoElement, canvasElement: HTMLCanvasElement) => {
      const adapter = adapterRef.current
      if (!adapter) {
        console.warn('[useFaceSwap] No adapter. Connect first.')
        return
      }
      if (!hasReferenceFace) {
        console.warn('[useFaceSwap] No reference face set.')
        return
      }

      videoRef.current = videoElement
      canvasRef.current = canvasElement
      isRunningRef.current = true
      processingRef.current = false
      setFaceSwapStatus('active')

      // Size the canvas to match the video
      if (canvasRef.current && videoRef.current) {
        canvasRef.current.width = videoRef.current.videoWidth || 640
        canvasRef.current.height = videoRef.current.videoHeight || 480
      }

      // Set up frame capture interval
      const fps = faceSwap.fps
      const intervalMs = 1000 / fps

      frameIntervalRef.current = setInterval(async () => {
        if (!isRunningRef.current || processingRef.current) return
        if (!videoRef.current || !canvasRef.current) return

        // Don't process if video isn't playing
        if (videoRef.current.readyState < 2) return

        processingRef.current = true

        try {
          const resultBlob = await adapter.swapFrame(videoRef.current)

          // Draw the result onto the canvas
          const img = new Image()
          img.onload = () => {
            const canvas = canvasRef.current!
            const ctx = canvas.getContext('2d')!
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            const scale = Math.min(
              canvas.width / img.width,
              canvas.height / img.height
            )
            const x = (canvas.width - img.width * scale) / 2
            const y = (canvas.height - img.height * scale) / 2
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale)
            URL.revokeObjectURL(img.src)
          }
          img.src = URL.createObjectURL(resultBlob)
        } catch (err) {
          if (err instanceof Error && !err.message.includes('Already processing')) {
            console.warn('[useFaceSwap] frame error:', err.message)
          }
        } finally {
          processingRef.current = false
        }
      }, intervalMs)
    },
    [hasReferenceFace, faceSwap.fps, setFaceSwapStatus]
  )

  /**
   * Stop the face swap pipeline.
   */
  const stopSwap = useCallback(() => {
    isRunningRef.current = false
    processingRef.current = false

    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current)
      frameIntervalRef.current = null
    }

    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    }

    setFaceSwapStatus('off')
  }, [setFaceSwapStatus])

  /**
   * Update the FPS setting.
   */
  const setFps = useCallback(
    (fps: FaceSwapFps) => {
      setFaceSwapFps(fps)
      if (isRunningRef.current && videoRef.current && canvasRef.current) {
        stopSwap()
        setTimeout(() => {
          if (videoRef.current && canvasRef.current) {
            startSwap(videoRef.current, canvasRef.current)
          }
        }, 100)
      }
    },
    [setFaceSwapFps, stopSwap, startSwap]
  )

  const getFps = useCallback((): FaceSwapFps => {
    return faceSwap.fps
  }, [faceSwap.fps])

  const getState = useCallback((): FaceSwapAdapterState => {
    return adapterRef.current?.getState() || adapterState
  }, [adapterState])

  // Auto-disconnect when face swap is disabled or provider removed
  useEffect(() => {
    if (!faceSwap.faceSwapEnabled || !activeFaceProvider) {
      disconnect()
    }
  }, [faceSwap.faceSwapEnabled, activeFaceProvider, disconnect])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSwap()
      adapterRef.current?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    connectionStatus,
    connect,
    disconnect,
    testConnection,
    hasReferenceFace,
    referenceFacePreview,
    setReferenceFace,
    setReferenceFromVideo,
    setReferenceFromFile,
    clearReference,
    isSwapping: adapterState.status === 'swapping',
    latency: adapterState.latency,
    framesProcessed: adapterState.framesProcessed,
    errorMessage: adapterState.errorMessage,
    startSwap,
    stopSwap,
    setFps,
    getFps,
    getState,
  }
}
