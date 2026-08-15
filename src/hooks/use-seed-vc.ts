'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStudioStore, type ConnectionStatus } from '@/stores/studio-store'
import {
  SeedVCAdapter,
  SeedVCRealtimePipeline,
  createSeedVCAdapter,
  audioBufferToMono,
  type SeedVCConfig,
  type SeedVCState,
} from '@/services/seed-vc-adapter'

/**
 * Return type for the useSeedVC hook.
 */
export interface UseSeedVCReturn {
  // Connection
  connectionStatus: ConnectionStatus
  connect: () => Promise<void>
  disconnect: () => void
  testConnection: () => Promise<{ success: boolean; latency: number; modelInfo?: string }>

  // Reference Audio
  referenceLoaded: boolean
  referenceDuration: number
  referenceSampleRate: number
  setReferenceAudio: (samples: Float32Array, sourceSampleRate: number) => void
  setReferenceAudioFromBuffer: (audioBuffer: AudioBuffer) => void
  setReferenceFromFile: (file: File) => Promise<void>
  clearReference: () => void
  recordReference: () => Promise<Float32Array>

  // Voice Conversion
  isConverting: boolean
  latency: number
  errorMessage: string | null
  convertChunk: (sourceSamples: Float32Array, sourceSampleRate: number) => Promise<Float32Array>
  convertFile: (file: File) => Promise<Float32Array>

  // Real-Time Pipeline
  isPipelineActive: boolean
  startPipeline: (stream: MediaStream) => Promise<void>
  stopPipeline: () => void

  // Config
  updateConfig: (partial: Partial<SeedVCConfig>) => void
  getConfig: () => SeedVCConfig
  getState: () => SeedVCState

  // Gradio schema info
  apiSchema: SeedVCState['apiSchema']
}

/**
 * useSeedVC — React hook wrapping the Seed-VC adapter.
 *
 * Integrates with the studio store for:
 *   - Active provider endpoint (BYOK)
 *   - Voice conversion enabled/disabled toggle
 *   - Voice pitch setting
 *   - Voice preset selection (determines model variant)
 *   - Audio levels (output meter)
 *
 * Usage in StudioShell:
 * ```tsx
 * const seedVC = useSeedVC()
 *
 * // Connect when user enables voice conversion
 * useEffect(() => {
 *   if (voiceConversionEnabled && activeProvider) {
 *     seedVC.connect()
 *   } else {
 *     seedVC.disconnect()
 *   }
 * }, [voiceConversionEnabled, activeProvider])
 * ```
 */
export function useSeedVC(): UseSeedVCReturn {
  const adapterRef = useRef<SeedVCAdapter | null>(null)
  const pipelineRef = useRef<SeedVCRealtimePipeline | null>(null)

  // Local state derived from adapter
  const [adapterState, setAdapterState] = useState<SeedVCState>({
    status: 'disconnected',
    latency: 0,
    errorMessage: null,
    referenceAudio: null,
    referenceSampleRate: 0,
    referenceDuration: 0,
    apiSchema: null,
  })
  const [isPipelineActive, setIsPipelineActive] = useState(false)

  // Studio store bindings
  const activeProvider = useStudioStore((s) => s.activeProvider)
  const voiceConversionEnabled = useStudioStore((s) => s.voiceConversionEnabled)
  const activeVoicePreset = useStudioStore((s) => s.activeVoicePreset)
  const voicePitch = useStudioStore((s) => s.voicePitch)
  const noiseGateEnabled = useStudioStore((s) => s.noiseGateEnabled)
  const noiseGateThreshold = useStudioStore((s) => s.noiseGateThreshold)
  const audioLevels = useStudioStore((s) => s.audioLevels)
  const updateProviderStatus = useStudioStore((s) => s.updateProviderStatus)
  const setAudioLevels = useStudioStore((s) => s.setAudioLevels)

  // Map adapter status to store ConnectionStatus
  const connectionStatus: ConnectionStatus =
    adapterState.status === 'connected' || adapterState.status === 'converting'
      ? 'connected'
      : adapterState.status === 'connecting'
        ? 'connecting'
        : adapterState.status === 'error'
          ? 'error'
          : 'disconnected'

  /**
   * Get or create the adapter instance from the active provider.
   */
  const getAdapter = useCallback((): SeedVCAdapter | null => {
    if (!activeProvider?.endpoint) return null

    // Recreate adapter if endpoint changed
    if (
      adapterRef.current &&
      adapterRef.current.getConfig().endpoint !== activeProvider.endpoint
    ) {
      adapterRef.current.disconnect()
      adapterRef.current = null
    }

    if (!adapterRef.current) {
      const modelVariant = mapPresetToModel(activeVoicePreset?.modelId)
      adapterRef.current = createSeedVCAdapter(activeProvider, {
        model: modelVariant,
        diffusionSteps: 10, // Real-time optimized
        cfgRate: 0.7,
        semiToneShift: voicePitch, // Map pitch slider to semitone shift
      })

      // Subscribe to state changes
      adapterRef.current.onStateChange((partial) => {
        setAdapterState((prev) => ({ ...prev, ...partial }))
      })
    }

    return adapterRef.current
  }, [activeProvider, activeVoicePreset, voicePitch])

  /**
   * Connect to the Seed-VC Gradio instance.
   */
  const connect = useCallback(async () => {
    const adapter = getAdapter()
    if (!adapter) {
      console.warn('[useSeedVC] No active provider configured')
      return
    }

    try {
      await adapter.connect()
      if (activeProvider?.id) {
        updateProviderStatus(activeProvider.id, 'connected')
      }
    } catch (err) {
      if (activeProvider?.id) {
        updateProviderStatus(activeProvider.id, 'error')
      }
    }
  }, [getAdapter, activeProvider, updateProviderStatus])

  /**
   * Disconnect from the Seed-VC instance.
   */
  const disconnect = useCallback(() => {
    stopPipeline()
    adapterRef.current?.disconnect()
    if (activeProvider?.id) {
      updateProviderStatus(activeProvider.id, 'disconnected')
    }
  }, [activeProvider, updateProviderStatus])

  /**
   * Test the connection to the Gradio instance.
   */
  const testConnection = useCallback(async () => {
    const adapter = getAdapter()
    if (!adapter) return { success: false, latency: 0, modelInfo: 'No provider configured' }
    return adapter.testConnection()
  }, [getAdapter])

  /**
   * Set reference audio from raw PCM samples.
   */
  const setReferenceAudio = useCallback(
    (samples: Float32Array, sourceSampleRate: number) => {
      adapterRef.current?.setReferenceAudio(samples, sourceSampleRate)
    },
    []
  )

  /**
   * Set reference audio from an AudioBuffer (decoded from File).
   */
  const setReferenceAudioFromBuffer = useCallback(
    (audioBuffer: AudioBuffer) => {
      adapterRef.current?.setReferenceAudioFromBuffer(audioBuffer)
    },
    []
  )

  /**
   * Load reference audio from a user-uploaded File.
   */
  const setReferenceFromFile = useCallback(async (file: File) => {
    await adapterRef.current?.loadReferenceFromFile(file)
  }, [])

  /**
   * Clear the current reference audio.
   */
  const clearReference = useCallback(() => {
    adapterRef.current?.clearReferenceAudio()
  }, [])

  /**
   * Record a short reference audio clip from the microphone.
   * Captures 3 seconds of audio and returns the PCM samples.
   * The caller can then pass these to setReferenceAudio().
   */
  const recordReference = useCallback(
    async (durationSeconds: number = 3): Promise<Float32Array> => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 48000, echoCancellation: true },
        video: false,
      })

      const ctx = new AudioContext({ sampleRate: 48000 })
      const source = ctx.createMediaStreamSource(stream)
      const processor = ctx.createScriptProcessor(4096, 1, 1)

      const allSamples: Float32Array[] = []
      let totalSamples = 0
      const targetSamples = durationSeconds * 48000

      return new Promise((resolve, reject) => {
        processor.onaudioprocess = (event) => {
          const data = event.inputBuffer.getChannelData(0)
          allSamples.push(new Float32Array(data))
          totalSamples += data.length

          if (totalSamples >= targetSamples) {
            processor.onaudioprocess = null
            source.disconnect()
            processor.disconnect()
            stream.getTracks().forEach((t) => t.stop())
            ctx.close()

            // Concatenate and trim to exact duration
            const result = new Float32Array(targetSamples)
            let offset = 0
            for (const chunk of allSamples) {
              const remaining = targetSamples - offset
              const toCopy = Math.min(chunk.length, remaining)
              if (toCopy <= 0) break
              result.set(chunk.subarray(0, toCopy), offset)
              offset += toCopy
            }

            resolve(result)
          }
        }

        source.connect(processor)
        // Don't connect to destination to avoid feedback

        // Timeout safety
        setTimeout(() => {
          reject(new Error('Reference recording timed out'))
        }, (durationSeconds + 2) * 1000)
      })
    },
    []
  )

  /**
   * Convert a single chunk of audio (for real-time pipeline use).
   */
  const convertChunk = useCallback(
    async (sourceSamples: Float32Array, sourceSampleRate: number): Promise<Float32Array> => {
      if (!adapterRef.current) throw new Error('Adapter not initialized')
      return adapterRef.current.convertChunk(sourceSamples, sourceSampleRate)
    },
    []
  )

  /**
   * Convert a complete audio file (offline mode).
   */
  const convertFile = useCallback(async (file: File): Promise<Float32Array> => {
    if (!adapterRef.current) throw new Error('Adapter not initialized')
    return adapterRef.current.convertFile(file)
  }, [])

  /**
   * Start the real-time voice conversion pipeline.
   * Takes an existing MediaStream (from the mic) and begins
   * chunked capture -> conversion -> playback.
   */
  const startPipeline = useCallback(
    async (stream: MediaStream) => {
      if (!adapterRef.current) throw new Error('Adapter not initialized. Call connect() first.')
      if (pipelineRef.current) stopPipeline()

      const audioContext = new AudioContext({ sampleRate: 48000 })
      const pipeline = new SeedVCRealtimePipeline(adapterRef.current, audioContext, {
        sourceSampleRate: 48000,
        chunkDuration: 0.18,
        crossfadeDuration: 0.04,
        leftContext: 2.5,
        rightContext: 0.02,
        noiseGate: noiseGateEnabled,
        noiseGateThreshold: noiseGateThreshold,
      })

      // Wire up output callback for level metering
      pipeline.setOnAudioOutput((samples) => {
        // Calculate output level for the meter
        let sum = 0
        for (let i = 0; i < samples.length; i++) {
          sum += samples[i] * samples[i]
        }
        const rms = Math.sqrt(sum / samples.length)
        const level = Math.min(100, rms * 300)

        setAudioLevels({ ...audioLevels, output: level })
      })

      pipeline.setOnError((err) => {
        console.error('[useSeedVC] pipeline error:', err)
      })

      await pipeline.start(stream)
      pipelineRef.current = pipeline
      setIsPipelineActive(true)
    },
    [noiseGateEnabled, noiseGateThreshold, setAudioLevels]
  )

  /**
   * Stop the real-time pipeline.
   */
  const stopPipeline = useCallback(() => {
    if (pipelineRef.current) {
      pipelineRef.current.stop()
      pipelineRef.current = null
    }
    setIsPipelineActive(false)
    setAudioLevels({ input: audioLevels.input, output: 0 })
  }, [setAudioLevels])

  /**
   * Update the adapter configuration.
   */
  const updateConfig = useCallback((partial: Partial<SeedVCConfig>) => {
    adapterRef.current?.updateConfig(partial)
  }, [])

  /**
   * Get the current adapter configuration.
   */
  const getConfig = useCallback((): SeedVCConfig => {
    return adapterRef.current?.getConfig() || {
      endpoint: '',
      model: 'seed-uvit-tat-xlsr-tiny',
      diffusionSteps: 10,
      cfgRate: 0.7,
      semiToneShift: 0,
      lengthAdjust: 1.0,
      f0Condition: false,
      autoF0Adjust: false,
    }
  }, [])

  /**
   * Get the current adapter state.
   */
  const getState = useCallback((): SeedVCState => {
    return adapterRef.current?.getState() || adapterState
  }, [adapterState])

  // Sync pitch changes from the store to the adapter
  useEffect(() => {
    if (adapterRef.current) {
      adapterRef.current.updateConfig({ semiToneShift: voicePitch })
    }
  }, [voicePitch])

  // Sync model changes from preset selection
  useEffect(() => {
    if (adapterRef.current && activeVoicePreset?.modelId) {
      const model = mapPresetToModel(activeVoicePreset.modelId)
      if (model) {
        adapterRef.current.updateConfig({ model })
      }
    }
  }, [activeVoicePreset])

  // Auto-disconnect when voice conversion is disabled or provider changes
  useEffect(() => {
    if (!voiceConversionEnabled || !activeProvider) {
      disconnect()
    }
  }, [voiceConversionEnabled, activeProvider, disconnect])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pipelineRef.current?.stop()
      adapterRef.current?.disconnect()
    }
  }, [])

  return {
    connectionStatus,
    connect,
    disconnect,
    testConnection,
    referenceLoaded: adapterState.referenceAudio !== null,
    referenceDuration: adapterState.referenceDuration,
    referenceSampleRate: adapterState.referenceSampleRate,
    setReferenceAudio,
    setReferenceAudioFromBuffer,
    setReferenceFromFile,
    clearReference,
    recordReference,
    isConverting: adapterState.status === 'converting',
    latency: adapterState.latency,
    errorMessage: adapterState.errorMessage,
    convertChunk,
    convertFile,
    isPipelineActive,
    startPipeline,
    stopPipeline,
    updateConfig,
    getConfig,
    getState,
    apiSchema: adapterState.apiSchema,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Map a voice preset modelId to a SeedVCConfig model variant.
 */
function mapPresetToModel(
  modelId?: string
): SeedVCConfig['model'] {
  switch (modelId) {
    case 'seed-uvit-tat-xlsr-tiny':
      return 'seed-uvit-tat-xlsr-tiny'
    case 'seed-uvit-whisper-small-wavenet':
      return 'seed-uvit-whisper-small-wavenet'
    case 'seed-uvit-whisper-base':
      return 'seed-uvit-whisper-base'
    case 'hubert-bsqvae-small':
      return 'hubert-bsqvae-small'
    default:
      return 'seed-uvit-tat-xlsr-tiny'
  }
}
