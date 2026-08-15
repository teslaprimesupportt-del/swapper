'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useStudioStore } from '@/stores/studio-store'

export function useCamera(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const streamRef = useRef<MediaStream | null>(null)
  const { cameraStatus, cameraFacingMode, setCameraStatus, toggleCameraFacing } = useStudioStore()

  const startCamera = useCallback(async () => {
    setCameraStatus('requesting')
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: cameraFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCameraStatus('active')
    } catch (err) {
      console.error('Camera access failed:', err)
      setCameraStatus('error')
    }
  }, [cameraFacingMode, setCameraStatus, videoRef])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraStatus('off')
  }, [setCameraStatus, videoRef])

  const flipCamera = useCallback(async () => {
    toggleCameraFacing()
    if (cameraStatus === 'active') {
      await startCamera()
    }
  }, [cameraStatus, startCamera, toggleCameraFacing])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  return { startCamera, stopCamera, flipCamera }
}
