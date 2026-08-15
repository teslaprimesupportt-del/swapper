'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useStudioStore } from '@/stores/studio-store'

export function useAudio() {
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const {
    audioStatus, isMuted, noiseGateEnabled, noiseGateThreshold,
    setAudioStatus, setAudioLevels, setMuted, setHeadphonesDetected,
  } = useStudioStore()

  const startAudio = useCallback(async () => {
    setAudioStatus('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
        video: false,
      })
      streamRef.current = stream

      const ctx = new AudioContext({ sampleRate: 48000 })
      audioContextRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      analyserRef.current = analyser

      // Detect headphones by checking audio output devices
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const audioOutputs = devices.filter((d) => d.kind === 'audiooutput')
        setHeadphonesDetected(audioOutputs.length > 1)
      } catch {
        // enumerateDevices may not be available before permission grant
      }

      // Level monitoring loop
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const monitorLevels = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
        }
        const avg = sum / dataArray.length
        const level = Math.min(100, (avg / 128) * 100)
        setAudioLevels({ input: level, output: 0 })
        animFrameRef.current = requestAnimationFrame(monitorLevels)
      }
      monitorLevels()

      setAudioStatus('active')
    } catch (err) {
      console.error('Audio access failed:', err)
      setAudioStatus('error')
    }
  }, [setAudioStatus, setAudioLevels, setHeadphonesDetected])

  const stopAudio = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    analyserRef.current = null
    setAudioStatus('off')
    setAudioLevels({ input: 0, output: 0 })
  }, [setAudioStatus, setAudioLevels])

  const toggleMute = useCallback(() => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks()
      audioTracks.forEach((t) => { t.enabled = isMuted })
    }
    setMuted(!isMuted)
  }, [isMuted, setMuted])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      if (audioContextRef.current) audioContextRef.current.close()
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return { startAudio, stopAudio, toggleMute, audioStream: streamRef }
}
