'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStudioStore, type ConnectionStatus } from '@/stores/studio-store'
import {
  SeedVCAdapter,
  SeedVCRealtimePipeline,
  createSeedVCAdapter,
  type SeedVCConfig,
  type SeedVCState,
} from '@/services/seed-vc-adapter'

export interface VoiceConversionState {
  status: ConnectionStatus
  latencyMs: number
  errorMessage: string | null
  chunksProcessed: number
  hasReferenceAudio: boolean
  isStreaming: boolean
}

/**
 * useVoiceConversion — React hook for Seed-VC voice conversion.
 *
 * Uses the NEW adapter from @/services/seed-vc-adapter which has proper
 * Gradio 4.x /call/{name} + polling support, WAV encoding/decoding,
 * and a SeedVCRealtimePipeline for chunked mic capture.
 */
export function useVoiceConversion() {
  const adapterRef = useRef<SeedVCAdapter | null>(null)
  const pipelineRef = useRef<SeedVCRealtimePipeline | null>(null)

  const [vcState, setVcState] = useState<VoiceConversionState>({
    status: 'disconnected',
    latencyMs: 0,
    errorMessage: null,
    chunksProcessed: 0,
    hasReferenceAudio: false,
    isStreaming: false,
  })

  const {
    activeProvider,
    voiceConversionEnabled,
    audioStatus,
    voicePitch,
    activeVoicePreset,
    noiseGateEnabled,
    noiseGateThreshold,
    updateProviderStatus,
    setAudioLevels,
    audioLevels,
  } = useStudioStore()

  // Map preset modelId to SeedVCConfig model variant
  const modelVariant = activeVoicePreset?.modelId as SeedVCConfig['model'] || 'seed-uvit-tat-xlsr-tiny'

  /**
   * Get or create the adapter from the active provider.
   * Recreates if the endpoint changes.
   */
  const getAdapter = useCallback((): SeedVCAdapter | null => {
    if (!activeProvider?.endpoint) return null

    // Recreate if endpoint changed
    if (
      adapterRef.current &&
      adapterRef.current.getConfig().endpoint !== activeProvider.endpoint
    ) {
      adapterRef.current.disconnect()
      adapterRef.current = null
    }

    if (!adapterRef.current) {
      adapterRef.current = createSeedVCAdapter(activeProvider, {
        model: modelVariant,
        diffusionSteps: 10,
        cfgRate: 0.7,
        semiToneShift: voicePitch,
      })

      // Subscribe to adapter state changes
      adapterRef.current.onStateChange((partial) => {
        setVcState((prev) => {
          const next: VoiceConversionState = { ...prev }
          if (partial.status !== undefined) {
            next.status =
              partial.status === 'connected' || partial.status === 'converting'
                ? 'connected'
                : partial.status === 'connecting'
                  ? 'connecting'
                  : partial.status === 'error'
                    ? 'error'
                    : 'disconnected'
          }
          if (partial.latency !== undefined) next.latencyMs = partial.latency
          if (partial.errorMessage !== undefined) next.errorMessage = partial.errorMessage
          if (partial.referenceAudio !== undefined) {
            next.hasReferenceAudio = partial.referenceAudio !== null
          }
          return next
        })
      })
    } else {
      // Update config on existing adapter (pitch, model changes)
      adapterRef.current.updateConfig({
        model: modelVariant,
        semiToneShift: voicePitch,
      })
    }

    return adapterRef.current
  }, [activeProvider, modelVariant, voicePitch])

  /**
   * Connect to the Seed-VC endpoint configured in activeProvider.
   */
  const connect = useCallback(async () => {
    const adapter = getAdapter()
    if (!adapter) {
      setVcState((prev) => ({ ...prev, errorMessage: 'No provider endpoint configured' }))
      return false
    }

    try {
      await adapter.connect()
      if (activeProvider?.id) {
        updateProviderStatus(activeProvider.id, 'connected')
      }
      return true
    } catch {
      if (activeProvider?.id) {
        updateProviderStatus(activeProvider.id, 'error')
      }
      return false
    }
  }, [getAdapter, activeProvider, updateProviderStatus])

  /**
   * Set reference audio from a File (uploaded by user).
   */
  const setReferenceAudio = useCallback(
    async (file: File | Blob) => {
      const adapter = getAdapter()
      if (!adapter) return
      await adapter.loadReferenceFromFile(file as File)
      setVcState((prev) => ({ ...prev, hasReferenceAudio: true }))
    },
    [getAdapter]
  )

  /**
   * Record a reference clip from the mic stream.
   * Captures `durationMs` of audio and returns the PCM samples.
   */
  const recordReference = useCallback(
    async (micStream: MediaStream, durationMs: number = 5000) => {
      const sampleRate = 48000
      const ctx = new AudioContext({ sampleRate })
      const source = ctx.createMediaStreamSource(micStream)
      const processor = ctx.createScriptProcessor(4096, 1, 1)

      const allSamples: Float32Array[] = []
      let totalSamples = 0
      const targetSamples = Math.floor((durationMs / 1000) * sampleRate)

      return new Promise<Float32Array | null>((resolve) => {
        processor.onaudioprocess = (event) => {
          const data = event.inputBuffer.getChannelData(0)
          allSamples.push(new Float32Array(data))
          totalSamples += data.length

          if (totalSamples >= targetSamples) {
            processor.onaudioprocess = null
            source.disconnect()
            processor.disconnect()
            ctx.close()

            // Concatenate and trim
            const result = new Float32Array(targetSamples)
            let offset = 0
            for (const chunk of allSamples) {
              const remaining = targetSamples - offset
              const toCopy = Math.min(chunk.length, remaining)
              if (toCopy <= 0) break
              result.set(chunk.subarray(0, toCopy), offset)
              offset += toCopy
            }

            // Set reference on the adapter
            const adapter = adapterRef.current
            if (adapter) {
              adapter.setReferenceAudio(result, sampleRate)
              setVcState((prev) => ({ ...prev, hasReferenceAudio: true }))
            }

            resolve(result)
          }
        }

        source.connect(processor)
        // Don't connect to destination to avoid feedback

        // Timeout safety
        setTimeout(() => {
          processor.onaudioprocess = null
          source.disconnect()
          processor.disconnect()
          ctx.close()
          resolve(null)
        }, (durationMs / 1000 + 2) * 1000)
      })
    },
    []
  )

  /**
   * Start real-time voice conversion streaming.
   * Takes the mic MediaStream and pipes it through Seed-VC.
   */
  const startConversion = useCallback(
    async (micStream: MediaStream) => {
      const adapter = adapterRef.current
      if (!adapter) {
        setVcState((prev) => ({ ...prev, errorMessage: 'Not connected. Click Connect first.' }))
        return
      }
      if (!adapter.getState().referenceAudio) {
        setVcState((prev) => ({ ...prev, errorMessage: 'No reference audio. Upload or record a voice first.' }))
        return
      }

      // Stop any existing pipeline
      stopConversion()

      const audioContext = new AudioContext({ sampleRate: 48000 })
      const pipeline = new SeedVCRealtimePipeline(adapter, audioContext, {
        sourceSampleRate: 48000,
        chunkDuration: 0.18,
        crossfadeDuration: 0.04,
        leftContext: 2.5,
        rightContext: 0.02,
        noiseGate: noiseGateEnabled,
        noiseGateThreshold: noiseGateThreshold,
      })

      let chunkCount = 0
      pipeline.setOnAudioOutput((samples) => {
        chunkCount++
        setVcState((prev) => ({ ...prev, chunksProcessed: chunkCount, isStreaming: true }))

        // Update output level meter
        let sum = 0
        for (let i = 0; i < samples.length; i++) {
          sum += samples[i] * samples[i]
        }
        const rms = Math.sqrt(sum / samples.length)
        const level = Math.min(100, rms * 300)
        setAudioLevels({ ...audioLevels, output: level })
      })

      pipeline.setOnError((err) => {
        setVcState((prev) => ({ ...prev, errorMessage: err.message, isStreaming: false }))
      })

      await pipeline.start(micStream)
      pipelineRef.current = pipeline
      setVcState((prev) => ({ ...prev, isStreaming: true, errorMessage: null }))
    },
    [noiseGateEnabled, noiseGateThreshold, setAudioLevels, audioLevels]
  )

  /**
   * Stop real-time voice conversion.
   */
  const stopConversion = useCallback(() => {
    if (pipelineRef.current) {
      pipelineRef.current.stop()
      pipelineRef.current = null
    }
    setVcState((prev) => ({ ...prev, isStreaming: false }))
    setAudioLevels({ ...audioLevels, output: 0 })
  }, [setAudioLevels, audioLevels])

  /**
   * Fully disconnect and cleanup.
   */
  const disconnect = useCallback(() => {
    stopConversion()
    adapterRef.current?.disconnect()
    if (activeProvider?.id) {
      updateProviderStatus(activeProvider.id, 'disconnected')
    }
    setVcState((prev) => ({
      ...prev,
      status: 'disconnected',
      errorMessage: null,
      isStreaming: false,
    }))
  }, [activeProvider, updateProviderStatus, stopConversion, setAudioLevels, audioLevels])

  // Auto-stop when voice conversion is disabled or audio stops
  useEffect(() => {
    if (!voiceConversionEnabled && vcState.isStreaming) {
      stopConversion()
    }
    if (audioStatus !== 'active' && vcState.isStreaming) {
      stopConversion()
    }
  }, [voiceConversionEnabled, audioStatus, vcState.isStreaming, stopConversion])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pipelineRef.current?.stop()
      adapterRef.current?.disconnect()
    }
  }, [])

  return {
    ...vcState,
    connect,
    setReferenceAudio,
    recordReference,
    startConversion,
    stopConversion,
    disconnect,
  }
}
