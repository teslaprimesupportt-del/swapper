'use client'

import { useCallback, useRef } from 'react'
import { useStudioStore } from '@/stores/studio-store'

export function useRecording() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationRef = useRef(0)
  const recordingStatus = useStudioStore((s) => s.recordingStatus)
  const setRecordingStatus = useStudioStore((s) => s.setRecordingStatus)
  const setRecordingDuration = useStudioStore((s) => s.setRecordingDuration)

  const startRecording = useCallback((stream: MediaStream) => {
    if (recordingStatus === 'recording') return

    chunksRef.current = []
    durationRef.current = 0
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm'

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2500000,
    })

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `studio-recording-${Date.now()}.webm`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      chunksRef.current = []
    }

    recorder.start(1000)
    mediaRecorderRef.current = recorder
    setRecordingStatus('recording')
    setRecordingDuration(0)

    timerRef.current = setInterval(() => {
      durationRef.current += 1
      setRecordingDuration(durationRef.current)
    }, 1000)
  }, [recordingStatus, setRecordingStatus, setRecordingDuration])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recordingStatus === 'recording') {
      mediaRecorderRef.current.stop()
      setRecordingStatus('stopped')
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [recordingStatus, setRecordingStatus])

  const toggleRecording = useCallback((stream: MediaStream) => {
    if (recordingStatus === 'recording') {
      stopRecording()
    } else {
      startRecording(stream)
    }
  }, [recordingStatus, startRecording, stopRecording])

  return { startRecording, stopRecording, toggleRecording }
}
