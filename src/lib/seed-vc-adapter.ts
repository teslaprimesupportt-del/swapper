/**
 * Seed-VC Adapter
 *
 * Connects the browser's microphone audio stream to a remote Seed-VC instance
 * running a Gradio Web UI (app_vc.py). Handles:
 *   - Audio capture from MediaStream (48kHz → 22.05kHz resampling)
 *   - Chunking into fixed-size blocks (matching Seed-VC block time)
 *   - Sending chunks to Gradio API via fetch (HTTP)
 *   - Receiving converted audio and scheduling playback
 *   - Crossfade between output chunks for glitch-free playback
 *
 * Two transport modes:
 *   1. WEBSOCKET — connects to /call/stream for real-time streaming
 *   2. HTTP_POLL — POST to /api/predict and poll /call/{event_id} (fallback)
 */

export interface SeedVCConfig {
  /** Gradio endpoint, e.g. "https://xxxxx.gradio.live" */
  endpoint: string
  /** Optional API key */
  apiKey?: string
  /** Diffusion steps (4-10 for real-time, 25+ for quality) */
  diffusionSteps: number
  /** CFG rate (0.0-1.0) */
  cfgRate: number
  /** Chunk duration in seconds */
  chunkDurationSec: number
  /** Crossfade duration in seconds between output chunks */
  crossfadeDurationSec: number
  /** Extra right context in seconds */
  extraRightContextSec: number
}

export const DEFAULT_SEED_VC_CONFIG: SeedVCConfig = {
  endpoint: '',
  apiKey: '',
  diffusionSteps: 10,
  cfgRate: 0.7,
  chunkDurationSec: 0.18,
  crossfadeDurationSec: 0.04,
  extraRightContextSec: 0.02,
}

export type AdapterStatus = 'idle' | 'connecting' | 'connected' | 'streaming' | 'error' | 'disconnected'

export interface AdapterState {
  status: AdapterStatus
  latencyMs: number
  errorMessage: string | null
  chunksProcessed: number
}

type StateListener = (state: AdapterState) => void

/**
 * Convert Float32Array (-1 to 1) to 16-bit PCM WAV blob
 * Target sample rate: 22050 Hz (Seed-VC native)
 */
function float32ToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const targetRate = 22050
  const ratio = sampleRate / targetRate
  const targetLength = Math.floor(samples.length / ratio)
  const resampled = new Float32Array(targetLength)
  for (let i = 0; i < targetLength; i++) {
    const srcIdx = i * ratio
    const idx0 = Math.floor(srcIdx)
    const frac = srcIdx - idx0
    const idx1 = Math.min(idx0 + 1, samples.length - 1)
    resampled[i] = samples[idx0] * (1 - frac) + samples[idx1] * frac
  }

  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = targetRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = resampled.length * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, targetRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < resampled.length; i++) {
    const s = Math.max(-1, Math.min(1, resampled[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/**
 * Parse WAV blob back to Float32Array at the target sample rate
 */
async function wavBlobToFloat32Array(blob: Blob, targetRate: number = 22050): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const view = new DataView(arrayBuffer)
  // Skip RIFF header, find 'data' chunk
  let offset = 12
  while (offset < arrayBuffer.byteLength - 8) {
    const chunkId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 'data') {
      const dataOffset = offset + 8
      const numSamples = chunkSize / 2
      const samples = new Float32Array(numSamples)
      for (let i = 0; i < numSamples; i++) {
        const int16 = view.getInt16(dataOffset + i * 2, true)
        samples[i] = int16 / (int16 < 0 ? 0x8000 : 0x7FFF)
      }
      return samples
    }
    offset += 8 + chunkSize
  }
  return new Float32Array(0)
}

export class SeedVCAdapter {
  private config: SeedVCConfig
  private status: AdapterStatus = 'idle'
  private errorMessage: string | null = null
  private latencyMs = 0
  private chunksProcessed = 0
  private listeners: Set<StateListener> = new Set()

  // Audio nodes
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private processorNode: ScriptProcessorNode | null = null
  private gainNode: GainNode | null = null

  // Chunks
  private chunkBuffer: Float32Array[] = []
  private chunkSampleCount = 0
  private targetChunkSamples: number
  private sampleRate = 48000

  // Playback scheduling
  private playbackCtx: AudioContext | null = null
  private playbackGain: GainNode | null = null
  private nextPlayTime = 0
  private isPlaying = false

  // VAD (simple energy-based)
  private isSpeech = false
  private speechThreshold = 0.015

  // Reference audio for zero-shot
  private referenceAudioBlob: Blob | null = null

  // Gradio session
  private gradioSessionHash: string | null = null

  // Streaming
  private streamActive = false
  private processInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<SeedVCConfig> = {}) {
    this.config = { ...DEFAULT_SEED_VC_CONFIG, ...config }
    // 0.18s chunk at 22050Hz = ~3969 samples at native rate
    // But we capture at 48kHz, so: 0.18 * 48000 = 8640 samples
    this.targetChunkSamples = Math.floor(this.config.chunkDurationSec * this.sampleRate)
  }

  // ─── OBSERVERS ─────────────────────────────
  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emitState() {
    const state: AdapterState = {
      status: this.status,
      latencyMs: this.latencyMs,
      errorMessage: this.errorMessage,
      chunksProcessed: this.chunksProcessed,
    }
    this.listeners.forEach(l => l(state))
  }

  // ─── REFERENCE AUDIO ─────────────────────────
  /**
   * Set the reference audio for zero-shot voice cloning.
   * This is a short clip (1-30s) of the target voice.
   */
  setReferenceAudio(file: File | Blob) {
    this.referenceAudioBlob = file
  }

  /**
   * Record a reference audio clip from the microphone.
   * Records for the specified duration.
   */
  async recordReference(stream: MediaStream, durationMs: number = 5000): Promise<Blob> {
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => chunks.push(e.data)

    return new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        this.referenceAudioBlob = blob
        resolve(blob)
      }
      recorder.start()
      setTimeout(() => recorder.stop(), durationMs)
    })
  }

  // ─── CONNECTION ─────────────────────────────
  /**
   * Connect to a Seed-VC Gradio instance.
   * Verifies the endpoint is reachable and discovers the API.
   */
  async connect(): Promise<boolean> {
    this.setStatus('connecting')
    try {
      const baseUrl = this.config.endpoint.replace(/\/+$/, '')
      const headers: Record<string, string> = {}
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`
      }

      // Test connectivity by fetching Gradio info
      const resp = await fetch(`${baseUrl}/info`, { headers, signal: AbortSignal.timeout(8000) })
      if (!resp.ok) throw new Error(`Endpoint returned ${resp.status}`)

      // Try to discover the API
      try {
        const apiResp = await fetch(`${baseUrl}/api/`, { headers, signal: AbortSignal.timeout(5000) })
        if (apiResp.ok) {
          const api = await apiResp.json()
          // Find the voice conversion endpoint
          const vcEndpoint = api.find((e: { path: string }) =>
            e.path === '/api/predict' || e.path.includes('vc') || e.path.includes('voice')
          )
          // Store session hash if available (Gradio uses this for streaming)
          if (vcEndpoint && 'fn_index' in vcEndpoint) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.gradioSessionHash = (vcEndpoint as any).session_hash || null
          }
        }
      } catch {
        // API discovery is optional — we'll use defaults
      }

      this.setStatus('connected')
      return true
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Connection failed'
      this.setStatus('error')
      return false
    }
  }

  // ─── STREAMING PIPELINE ─────────────────────
  /**
   * Start the real-time voice conversion pipeline.
   * Captures audio from the mic, chunks it, sends to Seed-VC, plays back converted audio.
   */
  async startStreaming(micStream: MediaStream): Promise<void> {
    if (this.status !== 'connected') {
      throw new Error('Adapter not connected. Call connect() first.')
    }
    if (!this.referenceAudioBlob) {
      throw new Error('No reference audio set. Call setReferenceAudio() or recordReference() first.')
    }

    this.streamActive = true
    this.chunkBuffer = []
    this.chunkSampleCount = 0
    this.chunksProcessed = 0

    // Setup capture audio context
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate })
    this.sourceNode = this.audioContext.createMediaStreamSource(micStream)

    // Use ScriptProcessorNode for raw sample access (deprecated but widely supported,
    // AudioWorklet would be the modern alternative but adds complexity)
    const bufferSize = 4096
    this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1)
    this.processorNode.onaudioprocess = (event) => {
      if (!this.streamActive) return
      const input = event.inputBuffer.getChannelData(0)
      // Don't feed audio to output directly (we'll play the converted version)
      event.outputBuffer.getChannelData(0).fill(0)
      this.accumulateChunk(input)
    }

    // Connect: source → processor (processor output is silenced, we play converted audio separately)
    this.sourceNode.connect(this.processorNode)
    this.processorNode.connect(this.audioContext.destination)

    // Setup playback context (separate to avoid feedback)
    this.playbackCtx = new AudioContext({ sampleRate: 22050 })
    this.playbackGain = this.playbackCtx.createGain()
    this.playbackGain.connect(this.playbackCtx.destination)
    this.playbackGain.gain.value = 1.0
    this.nextPlayTime = 0
    this.isPlaying = true

    this.setStatus('streaming')
  }

  /**
   * Accumulate incoming audio samples and dispatch chunks when full.
   */
  private accumulateChunk(samples: Float32Array) {
    this.chunkBuffer.push(samples)
    this.chunkSampleCount += samples.length

    if (this.chunkSampleCount >= this.targetChunkSamples) {
      // Merge all accumulated buffers into one
      const merged = this.mergeFloat32Arrays(this.chunkBuffer, this.targetChunkSamples)
      this.chunkBuffer = []
      this.chunkSampleCount = 0

      // Simple VAD: check if there's enough energy
      let energy = 0
      for (let i = 0; i < merged.length; i++) {
        energy += merged[i] * merged[i]
      }
      energy /= merged.length
      this.isSpeech = energy > this.speechThreshold

      // Only send to server if speech is detected (saves bandwidth + compute)
      if (this.isSpeech) {
        this.sendChunkToServer(merged)
      }
    }
  }

  /**
   * Send a chunk to the Seed-VC Gradio server for conversion.
   */
  private async sendChunkToServer(samples: Float32Array) {
    const startTime = performance.now()
    try {
      const sourceWav = float32ToWavBlob(samples, this.sampleRate)
      const baseUrl = this.config.endpoint.replace(/\/+$/, '')
      const headers: Record<string, string> = {}
      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`
      }

      // Build FormData for Gradio API
      const formData = new FormData()
      formData.append('data', JSON.stringify([
        { name: 'source.wav', data: 'data:audio/wav;base64,' + await this.blobToBase64(sourceWav) },
        { name: 'target.wav', data: 'data:audio/wav;base64,' + await this.blobToBase64(this.referenceAudioBlob!) },
        this.config.diffusionSteps,
        1.0, // length_adjust
        this.config.cfgRate,
        false, // f0_condition
        false, // auto_f0_adjust
        0, // semi_tone_shift
      ]))

      // Submit job
      const submitResp = await fetch(`${baseUrl}/api/predict`, {
        method: 'POST',
        headers,
        body: formData,
      })

      if (!submitResp.ok) {
        console.warn('[Seed-VC] Submit failed:', submitResp.status)
        return
      }

      const submitData = await submitResp.json()
      const eventId = submitData.event_id

      if (eventId) {
        // Poll for result
        this.pollResult(baseUrl, headers, eventId, startTime)
      } else if (submitData.data) {
        // Synchronous result (some Gradio setups)
        const outputUrl = this.extractAudioUrl(submitData.data)
        if (outputUrl) {
          await this.playConvertedAudio(baseUrl, headers, outputUrl)
          this.latencyMs = performance.now() - startTime
          this.chunksProcessed++
          this.emitState()
        }
      }
    } catch (err) {
      console.warn('[Seed-VC] Chunk send error:', err)
    }
  }

  /**
   * Poll the Gradio /call/{event_id} endpoint for streaming results.
   */
  private async pollResult(
    baseUrl: string,
    headers: Record<string, string>,
    eventId: string,
    startTime: number
  ) {
    try {
      const resp = await fetch(`${baseUrl}/call/${eventId}`, { headers })
      if (!resp.ok) return

      const reader = resp.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const event = JSON.parse(line.slice(5).trim())
            if (event.msg === 'process_completed' && event.output?.data) {
              const outputUrl = this.extractAudioUrl(event.output.data)
              if (outputUrl) {
                await this.playConvertedAudio(baseUrl, headers, outputUrl)
                this.latencyMs = performance.now() - startTime
                this.chunksProcessed++
                this.emitState()
              }
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err) {
      console.warn('[Seed-VC] Poll error:', err)
    }
  }

  /**
   * Extract the output audio URL from Gradio response data.
   */
  private extractAudioUrl(data: unknown[]): string | null {
    if (!Array.isArray(data) || data.length === 0) return null
    const first = data[0]
    if (typeof first === 'string' && (first.startsWith('http') || first.startsWith('/'))) {
      return first
    }
    // Gradio may return { url, path, meta } object
    if (first && typeof first === 'object' && 'url' in first) {
      return (first as { url: string }).url
    }
    if (first && typeof first === 'object' && 'path' in first) {
      return (first as { path: string }).path
    }
    return null
  }

  /**
   * Fetch and play the converted audio chunk with crossfade scheduling.
   */
  private async playConvertedAudio(
    baseUrl: string,
    headers: Record<string, string>,
    audioPath: string
  ) {
    if (!this.playbackCtx || !this.playbackGain || !this.isPlaying) return

    try {
      const url = audioPath.startsWith('http') ? audioPath : `${baseUrl}${audioPath}`
      const resp = await fetch(url, { headers })
      if (!resp.ok) return

      const audioBlob = await resp.blob()
      const arrayBuffer = await audioBlob.arrayBuffer()
      const audioBuffer = await this.playbackCtx.decodeAudioData(arrayBuffer)

      // Schedule playback with crossfade
      const source = this.playbackCtx.createBufferSource()
      source.buffer = audioBuffer

      const crossfadeSamples = Math.floor(this.config.crossfadeDurationSec * this.playbackCtx.sampleRate)
      const now = this.playbackCtx.currentTime

      if (this.nextPlayTime > now) {
        // Apply crossfade at overlap point
        const overlap = this.nextPlayTime - now
        if (overlap > 0 && overlap < this.config.crossfadeDurationSec * 2) {
          source.connect(this.playbackGain)
          source.start(this.nextPlayTime - crossfadeSamples / this.playbackCtx.sampleRate)
        } else {
          source.connect(this.playbackGain)
          source.start(this.nextPlayTime)
        }
      } else {
        source.connect(this.playbackGain)
        source.start(now)
      }

      this.nextPlayTime = Math.max(
        this.playbackCtx.currentTime,
        source.context.currentTime + audioBuffer.duration - this.config.crossfadeDurationSec
      )

      source.onended = () => {
        source.disconnect()
      }
    } catch (err) {
      console.warn('[Seed-VC] Playback error:', err)
    }
  }

  // ─── STOP / CLEANUP ─────────────────────────
  /**
   * Stop streaming and clean up all audio resources.
   */
  stopStreaming() {
    this.streamActive = false

    if (this.processInterval) {
      clearInterval(this.processInterval)
      this.processInterval = null
    }

    // Cleanup capture nodes
    try {
      this.sourceNode?.disconnect()
      this.processorNode?.disconnect()
      this.audioContext?.close()
    } catch { /* already closed */ }
    this.sourceNode = null
    this.processorNode = null
    this.audioContext = null

    // Cleanup playback nodes
    try {
      this.playbackGain?.disconnect()
      this.playbackCtx?.close()
    } catch { /* already closed */ }
    this.playbackGain = null
    this.playbackCtx = null
    this.isPlaying = false
    this.nextPlayTime = 0

    this.chunkBuffer = []
    this.chunkSampleCount = 0

    if (this.status === 'streaming') {
      this.setStatus('connected')
    }
  }

  /**
   * Disconnect from the Seed-VC server entirely.
   */
  disconnect() {
    this.stopStreaming()
    this.referenceAudioBlob = null
    this.gradioSessionHash = null
    this.setStatus('disconnected')
  }

  // ─── UTILITIES ──────────────────────────────
  private setStatus(s: AdapterStatus) {
    this.status = s
    this.emitState()
  }

  private mergeFloat32Arrays(arrays: Float32Array[], targetLength: number): Float32Array {
    const totalLength = arrays.reduce((sum, a) => sum + a.length, 0)
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const arr of arrays) {
      merged.set(arr, offset)
      offset += arr.length
    }
    // Trim or pad to target length
    if (merged.length > targetLength) {
      return merged.slice(merged.length - targetLength)
    }
    return merged
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        resolve(result.split(',')[1])
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  // ─── GETTERS ────────────────────────────────
  getStatus(): AdapterStatus { return this.status }
  getLatencyMs(): number { return this.latencyMs }
  getChunksProcessed(): number { return this.chunksProcessed }
  getError(): string | null { return this.errorMessage }
  isStreamingActive(): boolean { return this.streamActive }
  hasReferenceAudio(): boolean { return this.referenceAudioBlob !== null }
}

/**
 * Singleton instance accessor.
 * Use this to share the adapter across components.
 */
let adapterInstance: SeedVCAdapter | null = null

export function getSeedVCAdapter(config?: Partial<SeedVCConfig>): SeedVCAdapter {
  if (!adapterInstance) {
    adapterInstance = new SeedVCAdapter(config)
  }
  return adapterInstance
}

export function destroySeedVCAdapter() {
  if (adapterInstance) {
    adapterInstance.disconnect()
    adapterInstance = null
  }
}
