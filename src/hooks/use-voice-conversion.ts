'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStudioStore } from '@/stores/studio-store'
import {
  getSeedVCAdapter,
  destroySeedVCAdapter,
  type SeedVCConfig,
  type AdapterStatus,
} from '@/lib/seed-vc-adapter'

export interface VoiceConversionState {
  status: AdapterStatus
  latencyMs: number
  errorMessage: string | null
  chunksProcessed: number
  hasReferenceAudio: boolean
  isStreaming: boolean
}

export function useVoiceConversion() {
  const adapterRef = useRef<ReturnType<typeof getSeedVCAdapter> | null>(null)
  const [vcState, setVcState] = useState<VoiceConversionState>({
    status: 'idle',
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
    setActiveProvider,
    updateProviderStatus,
  } = useStudioStore()

  // Initialize adapter on first use
  useEffect(() => {
    if (!adapterRef.current) {
      adapterRef.current = getSeedVCAdapter()
    }

    const unsub = adapterRef.current.onStateChange((state) => {
      setVcState(prev => ({
        ...prev,
        status: state.status,
        latencyMs: state.latencyMs,
        errorMessage: state.errorMessage,
        chunksProcessed: state.chunksProcessed,
        isStreaming: state.status === 'streaming',
        hasReferenceAudio: adapterRef.current?.hasReferenceAudio() ?? false,
      }))

      // Sync adapter status to provider status in store
      if (state.status === 'connected' || state.status === 'streaming') {
        // We don't have the provider ID here, so we update the active provider
      }
    })

    return () => {
      unsub()
    }
  }, [])

  /**
   * Connect to the Seed-VC endpoint configured in activeProvider.
   * Call this after the user clicks "Use" on a provider in settings.
   */
  const connect = useCallback(async () => {
    const adapter = adapterRef.current || getSeedVCAdapter()
    adapterRef.current = adapter

    if (!activeProvider?.endpoint) {
      setVcState(prev => ({ ...prev, errorMessage: 'No provider endpoint configured' }))
      return false
    }

    const config: Partial<SeedVCConfig> = {
      endpoint: activeProvider.endpoint,
      apiKey: activeProvider.apiKey || undefined,
      diffusionSteps: 10,
      cfgRate: 0.7,
    }

    // Merge config - create new adapter instance if endpoint changed
    if (adapter.getStatus() !== 'idle' && adapter.getStatus() !== 'disconnected') {
      destroySeedVCAdapter()
    }
    const freshAdapter = getSeedVCAdapter(config)
    adapterRef.current = freshAdapter

    const connected = await freshAdapter.connect()
    if (connected && activeProvider.id) {
      updateProviderStatus(activeProvider.id, 'connected')
    } else if (activeProvider.id) {
      updateProviderStatus(activeProvider.id, 'error')
    }
    return connected
  }, [activeProvider, updateProviderStatus])

  /**
   * Set the reference audio for zero-shot voice cloning.
   */
  const setReferenceAudio = useCallback((file: File | Blob) => {
    adapterRef.current?.setReferenceAudio(file)
    setVcState(prev => ({ ...prev, hasReferenceAudio: true }))
  }, [])

  /**
   * Record a reference clip from the mic stream.
   */
  const recordReference = useCallback(async (micStream: MediaStream, durationMs?: number) => {
    const adapter = adapterRef.current
    if (!adapter) return null
    return adapter.recordReference(micStream, durationMs)
  }, [])

  /**
   * Start real-time voice conversion streaming.
   * Takes the mic MediaStream and pipes it through Seed-VC.
   */
  const startConversion = useCallback(async (micStream: MediaStream) => {
    const adapter = adapterRef.current
    if (!adapter) return
    await adapter.startStreaming(micStream)
  }, [])

  /**
   * Stop real-time voice conversion.
   */
  const stopConversion = useCallback(() => {
    adapterRef.current?.stopStreaming()
    setVcState(prev => ({ ...prev, isStreaming: false }))
  }, [])

  /**
   * Fully disconnect and cleanup.
   */
  const disconnect = useCallback(() => {
    adapterRef.current?.disconnect()
    if (activeProvider?.id) {
      updateProviderStatus(activeProvider.id, 'disconnected')
    }
  }, [activeProvider, updateProviderStatus])

  // Auto-connect when voice conversion is enabled and provider is set
  useEffect(() => {
    if (voiceConversionEnabled && activeProvider && activeProvider.status !== 'connected' && activeProvider.status !== 'connecting') {
      // Don't auto-connect, let the user trigger it
    }
  }, [voiceConversionEnabled, activeProvider])

  // Auto-stop conversion when voice conversion is disabled or audio stops
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
      adapterRef.current?.stopStreaming()
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
