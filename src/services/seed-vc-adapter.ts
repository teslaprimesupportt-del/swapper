/**
 * Seed-VC Adapter
 * 
 * Connects to a Seed-VC Gradio instance (Colab public URL or local) via HTTP API.
 * Handles audio encoding/decoding, reference audio management, and real-time
 * voice conversion chunk pipeline.
 * 
 * Gradio API contract:
 *   - GET  /info          → returns API schema with named endpoints and parameter types
 *   - POST /api/predict   → sync inference (source_wav, reference_wav) → converted_wav
 *   - POST /call/{fn}     → async: returns event_id, poll GET /call/{fn}/{event_id}
 *   - WS   /queue/join    → WebSocket async stream (optional future upgrade)
 * 
 * For real-time, we use the sync /api/predict endpoint with small chunks.
 * Seed-VC real-time model (seed-uvit-tat-xlsr-tiny) processes ~0.18s blocks
 * at ~150ms inference on RTX 3060, giving ~430ms total latency.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SeedVCConfig {
  /** Gradio endpoint URL, e.g. "https://xxxxx.gradio.live" */
  endpoint: string
  /** Optional API key if the Gradio instance requires auth */
  apiKey?: string
  /** Model variant to use */
  model: 'seed-uvit-tat-xlsr-tiny' | 'seed-uvit-whisper-small-wavenet' | 'seed-uvit-whisper-base' | 'hubert-bsqvae-small'
  /** Diffusion steps (4-10 for real-time, 25-50 for quality) */
  diffusionSteps: number
  /** CFG rate (0.0-1.0), set 0.0 for ~1.5x speedup */
  cfgRate: number
  /** Pitch shift in semitones (singing mode) */
  semiToneShift: number
  /** Length adjustment factor (1.0 = normal, <1 = faster, >1 = slower) */
  lengthAdjust: number
  /** Enable F0 conditioning (for singing voice conversion) */
  f0Condition: boolean
  /** Auto-adjust source pitch to target pitch level */
  autoF0Adjust: boolean
}

export interface SeedVCState {
  status: 'disconnected' | 'connecting' | 'connected' | 'converting' | 'error'
  latency: number          // last measured round-trip latency in ms
  errorMessage: string | null
  referenceAudio: Float32Array | null
  referenceSampleRate: number
  referenceDuration: number  // seconds
  apiSchema: GradioAPISchema | null
}

export interface GradioAPISchema {
  named_endpoints: Record<string, GradioEndpoint>
  unnamed_endpoints: Record<string, GradioEndpoint>
}

export interface GradioEndpoint {
  parameters: GradioParam[]
  returns: GradioParam[]
}

export interface GradioParam {
  label: string
  component: string
  type: string | null
  default?: unknown
}

export type SeedVCEventCallback = (state: Partial<SeedVCState>) => void

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Omit<SeedVCConfig, 'endpoint'> = {
  model: 'seed-uvit-tat-xlsr-tiny',
  diffusionSteps: 10,
  cfgRate: 0.7,
  semiToneShift: 0,
  lengthAdjust: 1.0,
  f0Condition: false,
  autoF0Adjust: false,
}

/**
 * Target sample rate for Seed-VC models.
 * V1 models (VC and real-time): 22050 Hz
 * Singing model: 44100 Hz
 * V2 model: 22050 Hz
 */
const MODEL_SAMPLE_RATES: Record<SeedVCConfig['model'], number> = {
  'seed-uvit-tat-xlsr-tiny': 22050,
  'seed-uvit-whisper-small-wavenet': 22050,
  'seed-uvit-whisper-base': 44100,
  'hubert-bsqvae-small': 22050,
}

// ─── Audio Codec Utilities ──────────────────────────────────────────────────

/**
 * Encode a Float32Array of PCM audio samples into a WAV file (as ArrayBuffer).
 * Seed-VC Gradio expects WAV format audio input.
 */
function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = samples.length * (bitsPerSample / 8)
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)           // chunk size
  view.setUint16(20, 1, true)             // PCM format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // PCM samples: Float32 [-1, 1] → Int16 [-32768, 32767]
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }

  return buffer
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/**
 * Decode a WAV ArrayBuffer back into Float32Array PCM samples.
 */
function decodeWAV(buffer: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(buffer)

  // Find 'RIFF' header
  if (view.getUint32(0, true) !== 0x46464952) { // 'RIFF' in LE
    throw new Error('Not a valid WAV file: missing RIFF header')
  }

  // Check WAVE format
  if (view.getUint32(8, true) !== 0x45564157) { // 'WAVE' in LE
    throw new Error('Not a valid WAV file: missing WAVE format')
  }

  let offset = 12
  let fmtChunkFound = false
  let sampleRate = 0
  let bitsPerSample = 16
  let numChannels = 1
  let dataOffset = 0
  let dataSize = 0

  // Parse chunks
  while (offset < buffer.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    )
    const chunkSize = view.getUint32(offset + 4, true)

    if (chunkId === 'fmt ') {
      fmtChunkFound = true
      const audioFormat = view.getUint16(offset + 8, true)
      if (audioFormat !== 1) {
        throw new Error(`Unsupported WAV format: ${audioFormat} (only PCM=1 supported)`)
      }
      numChannels = view.getUint16(offset + 10, true)
      sampleRate = view.getUint32(offset + 12, true)
      bitsPerSample = view.getUint16(offset + 22, true)
    } else if (chunkId === 'data') {
      dataOffset = offset + 8
      dataSize = chunkSize
      break
    }

    offset += 8 + chunkSize
    // Word-align
    if (chunkSize % 2 !== 0) offset++
  }

  if (!fmtChunkFound) throw new Error('WAV file missing fmt chunk')
  if (dataOffset === 0) throw new Error('WAV file missing data chunk')

  const bytesPerSample = bitsPerSample / 8
  const numSamples = Math.floor(dataSize / (numChannels * bytesPerSample))
  const samples = new Float32Array(numSamples)

  let readOffset = dataOffset
  for (let i = 0; i < numSamples; i++) {
    // Mix down to mono if stereo
    let sample = 0
    for (let ch = 0; ch < numChannels; ch++) {
      const chOffset = readOffset + ch * bytesPerSample
      if (bytesPerSample === 2) {
        sample += view.getInt16(chOffset, true) / 0x7FFF
      } else if (bytesPerSample === 1) {
        sample += (view.getUint8(chOffset) - 128) / 128
      }
    }
    samples[i] = sample / numChannels
    readOffset += numChannels * bytesPerSample
  }

  return { samples, sampleRate }
}

/**
 * Resample audio from one sample rate to another using linear interpolation.
 * Not as good as a polyphase filter but sufficient for voice conversion
 * where the model handles some artifacts.
 */
function resampleAudio(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples

  const ratio = fromRate / toRate
  const newLength = Math.round(samples.length / ratio)
  const result = new Float32Array(newLength)

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio
    const low = Math.floor(srcIndex)
    const high = Math.min(low + 1, samples.length - 1)
    const frac = srcIndex - low
    result[i] = samples[low] * (1 - frac) + samples[high] * frac
  }

  return result
}

/**
 * Convert Float32Array to base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Convert base64 string to ArrayBuffer.
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Convert an AudioBuffer (from Web Audio API) to mono Float32Array.
 */
export function audioBufferToMono(audioBuffer: AudioBuffer): Float32Array {
  const length = audioBuffer.length
  const mono = new Float32Array(length)
  const numChannels = audioBuffer.numberOfChannels

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      mono[i] += channelData[i]
    }
  }

  // Average across channels
  for (let i = 0; i < length; i++) {
    mono[i] /= numChannels
  }

  return mono
}

// ─── Gradio API Response Types ──────────────────────────────────────────────

/**
 * Gradio /api/predict response format.
 * The data array contains the return values from the API function.
 * For Seed-VC, the first element is the converted audio as a file object.
 */
interface GradioPredictResponse {
  data: unknown[]
}

interface GradioFileInfo {
  url: string
  path: string | null
  meta: { _type: string } | null
  orig_name: string
  size: number | null
  is_stream: boolean
}

// ─── Seed-VC Adapter Class ──────────────────────────────────────────────────

export class SeedVCAdapter {
  private config: SeedVCConfig
  private state: SeedVCState
  private listeners: Set<SeedVCEventCallback> = new Set()
  private abortController: AbortController | null = null
  private isProcessing: boolean = false

  constructor(config: Partial<SeedVCConfig> & { endpoint: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.state = {
      status: 'disconnected',
      latency: 0,
      errorMessage: null,
      referenceAudio: null,
      referenceSampleRate: 0,
      referenceDuration: 0,
      apiSchema: null,
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Connect to the Gradio instance and fetch the API schema.
   * Must be called before any conversion operations.
   */
  async connect(): Promise<void> {
    this.updateState({ status: 'connecting', errorMessage: null })

    try {
      const schema = await this.fetchAPISchema()
      this.updateState({
        status: 'connected',
        apiSchema: schema,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect'
      this.updateState({ status: 'error', errorMessage: message })
      throw err
    }
  }

  /**
   * Disconnect from the Gradio instance.
   */
  disconnect(): void {
    this.cancelPendingRequests()
    this.updateState({
      status: 'disconnected',
      apiSchema: null,
    })
  }

  /**
   * Set the reference audio (target voice to clone).
   * Accepts Float32Array PCM samples at any sample rate — will be resampled
   * to the model's target rate internally.
   */
  setReferenceAudio(samples: Float32Array, sourceSampleRate: number): void {
    const targetRate = MODEL_SAMPLE_RATES[this.config.model]
    const resampled = resampleAudio(samples, sourceSampleRate, targetRate)
    const duration = resampled.length / targetRate

    this.updateState({
      referenceAudio: resampled,
      referenceSampleRate: targetRate,
      referenceDuration: duration,
    })
  }

  /**
   * Set reference audio from an AudioBuffer (e.g. decoded from a File).
   */
  setReferenceAudioFromBuffer(audioBuffer: AudioBuffer): void {
    const mono = audioBufferToMono(audioBuffer)
    this.setReferenceAudio(mono, audioBuffer.sampleRate)
  }

  /**
   * Clear the current reference audio.
   */
  clearReferenceAudio(): void {
    this.updateState({
      referenceAudio: null,
      referenceSampleRate: 0,
      referenceDuration: 0,
    })
  }

  /**
   * Load reference audio from a File object (user uploads a recording).
   * Decodes the file using Web Audio API and sets it as the reference.
   */
  async loadReferenceFromFile(file: File): Promise<void> {
    const arrayBuffer = await file.arrayBuffer()
    const audioContext = new OfflineAudioContext(1, 1, 48000) // dummy context
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    this.setReferenceAudioFromBuffer(audioBuffer)
  }

  /**
   * Convert a single chunk of audio (source speech) using the loaded
   * reference voice. Returns the converted audio as Float32Array.
   * 
   * This is the core method for real-time pipeline:
   *   1. Mic captures 0.18s chunk → Float32Array
   *   2. Call convertChunk() → converted Float32Array
   *   3. Play converted audio through speakers
   */
  async convertChunk(sourceSamples: Float32Array, sourceSampleRate: number): Promise<Float32Array> {
    if (this.state.status !== 'connected') {
      throw new Error('Not connected. Call connect() first.')
    }
    if (!this.state.referenceAudio) {
      throw new Error('No reference audio set. Call setReferenceAudio() first.')
    }
    if (this.isProcessing) {
      throw new Error('Already processing a chunk. Wait for the previous conversion to complete.')
    }

    this.isProcessing = true
    this.updateState({ status: 'converting' })

    try {
      const startTime = performance.now()

      // Resample source to model's target rate
      const targetRate = MODEL_SAMPLE_RATES[this.config.model]
      const resampledSource = resampleAudio(sourceSamples, sourceSampleRate, targetRate)

      // Encode both source and reference as WAV
      const sourceWAV = encodeWAV(resampledSource, targetRate)
      const referenceWAV = encodeWAV(this.state.referenceAudio, targetRate)

      // Encode to base64 for Gradio file upload
      const sourceBase64 = arrayBufferToBase64(sourceWAV)
      const referenceBase64 = arrayBufferToBase64(referenceWAV)

      // Call the Gradio API
      const convertedWAV = await this.callGradioAPI(sourceBase64, referenceBase64, 'source.wav', 'reference.wav')

      // Decode the response
      const { samples: convertedSamples } = decodeWAV(convertedWAV)

      // Resample back to original sample rate for playback
      const outputSamples = resampleAudio(convertedSamples, targetRate, sourceSampleRate)

      const endTime = performance.now()
      this.updateState({ latency: Math.round(endTime - startTime) })

      return outputSamples
    } finally {
      this.isProcessing = false
      // Reset status if still in converting state
      // (TS narrows this.state.status to 'connected' after the guard above,
      //  so we read through a widened variable)
      const currentStatus = this.state.status as SeedVCState['status']
      if (currentStatus === 'converting') {
        this.updateState({ status: 'connected' })
      }
    }
  }

  /**
   * Convert a complete audio file (non-real-time, offline mode).
   * Useful for processing pre-recorded audio.
   */
  async convertFile(sourceFile: File): Promise<Float32Array> {
    if (this.state.status !== 'connected') {
      throw new Error('Not connected. Call connect() first.')
    }
    if (!this.state.referenceAudio) {
      throw new Error('No reference audio set.')
    }

    const arrayBuffer = await sourceFile.arrayBuffer()
    const audioContext = new OfflineAudioContext(1, 1, 48000)
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    const mono = audioBufferToMono(audioBuffer)

    // For longer files, chunk them to avoid Gradio timeouts
    const targetRate = MODEL_SAMPLE_RATES[this.config.model]
    const resampled = resampleAudio(mono, audioBuffer.sampleRate, targetRate)

    // 10 second chunks at model sample rate
    const chunkDuration = 10 * targetRate
    const chunks: Float32Array[] = []

    for (let start = 0; start < resampled.length; start += chunkDuration) {
      const end = Math.min(start + chunkDuration, resampled.length)
      const chunk = resampled.slice(start, end)
      chunks.push(chunk)
    }

    // Process chunks sequentially (could parallelize for offline)
    const convertedChunks: Float32Array[] = []
    for (const chunk of chunks) {
      const converted = await this.convertChunk(chunk, targetRate)
      convertedChunks.push(converted)
    }

    // Concatenate all converted chunks
    const totalLength = convertedChunks.reduce((sum, c) => sum + c.length, 0)
    const result = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of convertedChunks) {
      result.set(chunk, offset)
      offset += chunk.length
    }

    return result
  }

  /**
   * Test the connection to the Gradio instance.
   * Returns true if the connection is healthy.
   */
  async testConnection(): Promise<{ success: boolean; latency: number; modelInfo?: string }> {
    const startTime = performance.now()
    try {
      const schema = await this.fetchAPISchema()
      const latency = Math.round(performance.now() - startTime)

      // Try to identify which Seed-VC endpoints are available
      const endpoints = Object.keys(schema.named_endpoints || {})
      const modelInfo = endpoints.length > 0
        ? `Available endpoints: ${endpoints.join(', ')}`
        : 'No named endpoints found'

      this.updateState({ status: 'connected', apiSchema: schema, latency })
      return { success: true, latency, modelInfo }
    } catch (err) {
      const latency = Math.round(performance.now() - startTime)
      const message = err instanceof Error ? err.message : 'Connection failed'
      this.updateState({ status: 'error', errorMessage: message })
      return { success: false, latency, modelInfo: message }
    }
  }

  /**
   * Update the configuration (e.g. change model, diffusion steps, etc.)
   */
  updateConfig(partial: Partial<SeedVCConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  /**
   * Get current adapter state.
   */
  getState(): SeedVCState {
    return { ...this.state }
  }

  /**
   * Get current configuration.
   */
  getConfig(): SeedVCConfig {
    return { ...this.config }
  }

  /**
   * Subscribe to state changes.
   */
  onStateChange(callback: SeedVCEventCallback): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  // ─── Private Methods ─────────────────────────────────────────────────────

  private updateState(partial: Partial<SeedVCState>): void {
    this.state = { ...this.state, ...partial }
    this.listeners.forEach((listener) => {
      try {
        listener(partial)
      } catch (e) {
        console.error('[SeedVCAdapter] listener error:', e)
      }
    })
  }

  private getBaseUrl(): string {
    return this.config.endpoint.replace(/\/+$/, '')
  }

  private async fetchAPISchema(): Promise<GradioAPISchema> {
    const url = `${this.getBaseUrl()}/info`
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: this.getSignal(),
    })

    if (!response.ok) {
      throw new Error(`Gradio /info failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data as GradioAPISchema
  }

  /**
   * Call the Gradio API to perform voice conversion.
   * 
   * Seed-VC's Gradio app typically exposes endpoints like:
   *   - /api/predict (legacy sync)
   *   - /call/{fn_name} (async)
   * 
   * We detect the available endpoint from the schema and use it.
   * The function sends source WAV + reference WAV and receives converted WAV.
   */
  private async callGradioAPI(
    sourceBase64: string,
    referenceBase64: string,
    sourceName: string,
    referenceName: string
  ): Promise<ArrayBuffer> {
    const baseUrl = this.getBaseUrl()
    const schema = this.state.apiSchema

    // Strategy 1: Try named endpoints (Gradio 4.x /call/{name} pattern)
    if (schema?.named_endpoints) {
      const endpointNames = Object.keys(schema.named_endpoints)
      // Look for VC-related endpoints
      const vcEndpoint = endpointNames.find(n =>
        /vc|voice|convert|real.?time/i.test(n)
      ) || endpointNames[0]

      if (vcEndpoint) {
        return await this.callNamedEndpoint(baseUrl, vcEndpoint, sourceBase64, referenceBase64)
      }
    }

    // Strategy 2: Fall back to legacy /api/predict
    return await this.callLegacyPredict(baseUrl, sourceBase64, referenceBase64)
  }

  /**
   * Call a named Gradio endpoint using the async /call/{name} pattern.
   * POST /call/{name} -> get event_id -> GET /call/{name}/{event_id} -> poll for result
   */
  private async callNamedEndpoint(
    baseUrl: string,
    endpointName: string,
    sourceBase64: string,
    referenceBase64: string
  ): Promise<ArrayBuffer> {
    const url = `${baseUrl}/call/${endpointName}`

    // Step 1: Submit the job
    const submitResponse = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Gradio expects data as an array of parameter values
        // The order must match the endpoint's parameter list
        data: [
          { data: sourceBase64, meta: { _type: 'gradio.FileData' } },
          { data: referenceBase64, meta: { _type: 'gradio.FileData' } },
          // Additional params depend on the Gradio app's interface
          this.config.diffusionSteps,
          this.config.cfgRate,
          this.config.semiToneShift,
          this.config.lengthAdjust,
          this.config.f0Condition,
          this.config.autoF0Adjust,
        ],
      }),
      signal: this.getSignal(),
    })

    if (!submitResponse.ok) {
      throw new Error(`Gradio submit failed: ${submitResponse.status} ${submitResponse.statusText}`)
    }

    const submitData = await submitResponse.json()
    const eventId = submitData.event_id

    if (!eventId) {
      // If no event_id, try treating response as direct result (sync mode)
      if (submitData.data) {
        return await this.extractAudioFromResponse(submitData, baseUrl)
      }
      throw new Error('Gradio did not return an event_id')
    }

    // Step 2: Poll for the result
    return await this.pollForResult(baseUrl, endpointName, eventId)
  }

  /**
   * Poll the Gradio event endpoint until the job completes.
   * Gradio sends SSE-style events: 'processing', 'complete', 'error'.
   */
  private async pollForResult(
    baseUrl: string,
    endpointName: string,
    eventId: string
  ): Promise<ArrayBuffer> {
    const url = `${baseUrl}/call/${endpointName}/${eventId}`
    const maxPollTime = 30_000 // 30 second timeout for polling
    const pollInterval = 200   // poll every 200ms
    const startTime = Date.now()

    while (Date.now() - startTime < maxPollTime) {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: this.getSignal(),
      })

      if (!response.ok) {
        throw new Error(`Gradio poll failed: ${response.status}`)
      }

      const event = await response.json()

      switch (event.msg) {
        case 'processing':
          // Still working, continue polling
          break

        case 'complete':
          return await this.extractAudioFromResponse(event.output, baseUrl)

        case 'error':
          throw new Error(`Seed-VC inference error: ${event.output?.error || 'Unknown error'}`)

        default:
          // Unknown message type, keep polling
          break
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    throw new Error(`Seed-VC inference timed out after ${maxPollTime / 1000}s`)
  }

  /**
   * Fall back to the legacy Gradio /api/predict sync endpoint.
   * Used when named endpoints are not available (older Gradio versions).
   */
  private async callLegacyPredict(
    baseUrl: string,
    sourceBase64: string,
    referenceBase64: string
  ): Promise<ArrayBuffer> {
    const url = `${baseUrl}/api/predict`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Legacy Gradio expects fn_index and data array
        fn_index: 0,
        data: [
          { data: sourceBase64, meta: { _type: 'gradio.FileData' } },
          { data: referenceBase64, meta: { _type: 'gradio.FileData' } },
        ],
      }),
      signal: this.getSignal(),
    })

    if (!response.ok) {
      throw new Error(`Gradio /api/predict failed: ${response.status} ${response.statusText}`)
    }

    const result = await response.json() as GradioPredictResponse
    return await this.extractAudioFromResponse(result, baseUrl)
  }

  /**
   * Extract audio ArrayBuffer from a Gradio API response.
   * Gradio returns file info with a URL; we download the actual WAV data.
   */
  private async extractAudioFromResponse(
    response: { data?: unknown[]; output?: unknown[] },
    baseUrl: string
  ): Promise<ArrayBuffer> {
    const dataArray = response.data || response.output
    if (!dataArray || dataArray.length === 0) {
      throw new Error('Gradio returned empty data')
    }

    const firstResult = dataArray[0]

    // Case 1: Direct base64 data (some Gradio configs return inline data)
    if (typeof firstResult === 'string' && firstResult.startsWith('data:')) {
      const base64Data = firstResult.split(',')[1]
      if (base64Data) {
        return base64ToArrayBuffer(base64Data)
      }
    }

    // Case 2: File URL (standard Gradio behavior)
    if (firstResult && typeof firstResult === 'object') {
      const fileInfo = firstResult as GradioFileInfo
      let fileUrl = fileInfo.url || ''

      // Handle relative URLs
      if (fileUrl.startsWith('/')) {
        fileUrl = `${baseUrl}${fileUrl}`
      }

      if (!fileUrl) {
        throw new Error('Gradio file response has no URL')
      }

      const audioResponse = await fetch(fileUrl, {
        headers: this.getHeaders(),
        signal: this.getSignal(),
      })

      if (!audioResponse.ok) {
        throw new Error(`Failed to download converted audio: ${audioResponse.status}`)
      }

      return await audioResponse.arrayBuffer()
    }

    throw new Error(`Unexpected Gradio response format: ${typeof firstResult}`)
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    }
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`
    }
    return headers
  }

  private getSignal(): AbortSignal {
    if (!this.abortController) {
      this.abortController = new AbortController()
    }
    return this.abortController.signal
  }

  private cancelPendingRequests(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    this.isProcessing = false
  }
}

// ─── Real-Time Pipeline ─────────────────────────────────────────────────────

/**
 * Configuration for the real-time audio processing pipeline.
 */
export interface RealtimePipelineConfig {
  /** Source audio sample rate (from browser mic, typically 48000) */
  sourceSampleRate: number
  /** Duration of each audio chunk in seconds (Seed-VC default: 0.18s) */
  chunkDuration: number
  /** Crossfade duration between chunks in seconds (Seed-VC default: 0.04s) */
  crossfadeDuration: number
  /** Extra left context in seconds (Seed-VC default: 2.5s) */
  leftContext: number
  /** Extra right context in seconds (Seed-VC default: 0.02s) */
  rightContext: number
  /** Whether to apply noise gate before sending chunks */
  noiseGate: boolean
  /** Noise gate threshold in dB (e.g. -40) */
  noiseGateThreshold: number
}

const DEFAULT_PIPELINE_CONFIG: RealtimePipelineConfig = {
  sourceSampleRate: 48000,
  chunkDuration: 0.18,
  crossfadeDuration: 0.04,
  leftContext: 2.5,
  rightContext: 0.02,
  noiseGate: true,
  noiseGateThreshold: -40,
}

/**
 * Seed-VC Real-Time Pipeline
 *
 * Manages the continuous audio stream:
 *   1. Captures chunks from the microphone via ScriptProcessorNode/AudioWorklet
 *   2. Maintains a rolling buffer with left/right context
 *   3. Sends chunks to SeedVCAdapter.convertChunk()
 *   4. Crossfades output chunks for smooth playback
 *
 * Usage:
 *   const pipeline = new SeedVCRealtimePipeline(adapter, audioContext, config)
 *   pipeline.start()
 *   // ... real-time conversion happens ...
 *   pipeline.stop()
 */
export class SeedVCRealtimePipeline {
  private adapter: SeedVCAdapter
  private audioContext: AudioContext
  private config: RealtimePipelineConfig
  private isRunning: boolean = false

  // Audio nodes
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private processorNode: ScriptProcessorNode | null = null
  private gainNode: GainNode | null = null

  // Buffers
  private inputRingBuffer: Float32Array = new Float32Array(0)
  private readonly maxBufferSize: number
  private playbackQueue: Float32Array[] = []
  private isPlaying: boolean = false

  // Callbacks
  private onAudioOutput: ((samples: Float32Array) => void) | null = null
  private onError: ((error: Error) => void) | null = null

  constructor(
    adapter: SeedVCAdapter,
    audioContext: AudioContext,
    config: Partial<RealtimePipelineConfig> = {}
  ) {
    this.adapter = adapter
    this.audioContext = audioContext
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config }
    // Max buffer = left context + right context + chunk, with 2x safety margin
    this.maxBufferSize = Math.ceil(
      (this.config.leftContext + this.config.rightContext + this.config.chunkDuration) * 2
      * this.config.sourceSampleRate
    )
  }

  /**
   * Start the real-time conversion pipeline.
   * Connects to the microphone and begins processing audio chunks.
   */
  async start(stream: MediaStream): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true

    // Create audio nodes
    this.sourceNode = this.audioContext.createMediaStreamSource(stream)
    this.gainNode = this.audioContext.createGain()
    this.gainNode.gain.value = 1.0

    // ScriptProcessorNode for capturing raw PCM (deprecated but universally supported)
    // Buffer size = chunk duration in samples
    const bufferSize = Math.ceil(
      this.config.chunkDuration * this.config.sourceSampleRate / 128
    ) * 128 // Round up to power-of-2 multiple
    this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1)

    this.processorNode.onaudioprocess = (event) => {
      if (!this.isRunning) return
      const inputData = event.inputBuffer.getChannelData(0)
      this.processInputChunk(inputData)
    }

    // Connect: mic -> processor (for capture) -> gain -> destination (for monitoring)
    // We don't connect processor to gain to avoid feedback loop
    this.sourceNode.connect(this.processorNode)
    // processor is NOT connected to destination to prevent echo
  }

  /**
   * Stop the real-time pipeline and release resources.
   */
  stop(): void {
    this.isRunning = false

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null
      this.processorNode.disconnect()
      this.processorNode = null
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }
    if (this.gainNode) {
      this.gainNode.disconnect()
      this.gainNode = null
    }

    this.inputRingBuffer = new Float32Array(0)
    this.playbackQueue = []
    this.isPlaying = false
  }

  /**
   * Register a callback for converted audio output.
   * The callback receives Float32Array samples ready for playback.
   */
  setOnAudioOutput(callback: (samples: Float32Array) => void): void {
    this.onAudioOutput = callback
  }

  /**
   * Register a callback for errors.
   */
  setOnError(callback: (error: Error) => void): void {
    this.onError = callback
  }

  /**
   * Play converted audio through the speakers.
   * Creates a temporary AudioBufferSourceNode for each chunk.
   */
  playConvertedAudio(samples: Float32Array): void {
    const sampleRate = this.config.sourceSampleRate
    const audioBuffer = this.audioContext.createBuffer(1, samples.length, sampleRate)
    audioBuffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)

    const source = this.audioContext.createBufferSource()
    source.buffer = audioBuffer

    const gainNode = this.audioContext.createGain()
    gainNode.gain.value = 1.0

    source.connect(gainNode)
    gainNode.connect(this.audioContext.destination)
    source.start()

    source.onended = () => {
      gainNode.disconnect()
    }
  }

  /**
   * Process an incoming chunk of audio from the microphone.
   * Accumulates into ring buffer, extracts chunks with context, sends to adapter.
   */
  private processInputChunk(inputData: Float32Array): void {
    // Append to ring buffer
    const newBuffer = new Float32Array(this.inputRingBuffer.length + inputData.length)
    newBuffer.set(this.inputRingBuffer)
    newBuffer.set(inputData, this.inputRingBuffer.length)
    this.inputRingBuffer = newBuffer

    // Trim buffer if it exceeds max size
    if (this.inputRingBuffer.length > this.maxBufferSize) {
      const trimAmount = this.inputRingBuffer.length - this.maxBufferSize
      this.inputRingBuffer = this.inputRingBuffer.slice(trimAmount)
    }

    // Check if we have enough audio for a chunk
    const chunkSamples = Math.ceil(this.config.chunkDuration * this.config.sourceSampleRate)
    const totalNeeded = chunkSamples
      + Math.ceil(this.config.leftContext * this.config.sourceSampleRate)
      + Math.ceil(this.config.rightContext * this.config.sourceSampleRate)

    if (this.inputRingBuffer.length >= totalNeeded) {
      // Extract the chunk with context
      this.extractAndConvert(chunkSamples)
    }
  }

  /**
   * Extract a chunk from the ring buffer with left/right context
   * and send it to the Seed-VC adapter for conversion.
   */
  private async extractAndConvert(chunkSamples: number): Promise<void> {
    const leftCtxSamples = Math.ceil(this.config.leftContext * this.config.sourceSampleRate)
    const rightCtxSamples = Math.ceil(this.config.rightContext * this.config.sourceSampleRate)

    // The chunk is in the middle of the buffer
    const leftStart = this.inputRingBuffer.length - leftCtxSamples - chunkSamples - rightCtxSamples
    const chunkStart = leftStart + leftCtxSamples
    const chunkEnd = chunkStart + chunkSamples

    if (chunkStart < 0 || chunkEnd > this.inputRingBuffer.length) return

    // Extract just the chunk portion for conversion
    // (The adapter/referene audio handles the voice characteristics;
    // context is managed by Seed-VC internally for streaming mode)
    const chunk = this.inputRingBuffer.slice(chunkStart, chunkEnd)

    // Noise gate check
    if (this.config.noiseGate) {
      const rms = this.calculateRMS(chunk)
      const db = 20 * Math.log10(rms + 1e-10)
      if (db < this.config.noiseGateThreshold) {
        // Below noise gate, skip conversion but advance buffer
        this.advanceBuffer(chunkSamples)
        return
      }
    }

    try {
      // Send to adapter for conversion
      const converted = await this.adapter.convertChunk(chunk, this.config.sourceSampleRate)

      // Notify via callback
      if (this.onAudioOutput) {
        this.onAudioOutput(converted)
      }

      // Auto-play if no callback set
      if (!this.onAudioOutput) {
        this.playConvertedAudio(converted)
      }

      // Advance the buffer past this chunk
      this.advanceBuffer(chunkSamples)
    } catch (err) {
      if (this.onError) {
        this.onError(err instanceof Error ? err : new Error(String(err)))
      } else {
        console.error('[SeedVCRealtimePipeline] conversion error:', err)
      }
    }
  }

  /**
   * Advance the ring buffer forward by the given number of samples.
   */
  private advanceBuffer(samples: number): void {
    if (this.inputRingBuffer.length > samples) {
      this.inputRingBuffer = this.inputRingBuffer.slice(samples)
    } else {
      this.inputRingBuffer = new Float32Array(0)
    }
  }

  /**
   * Calculate RMS (Root Mean Square) of audio samples.
   */
  private calculateRMS(samples: Float32Array): number {
    let sum = 0
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i]
    }
    return Math.sqrt(sum / samples.length)
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a Seed-VC adapter from a studio store AIProviderConfig.
 * This is the main entry point for the BYOK integration.
 *
 * @example
 * ```ts
 * const provider = useStudioStore(s => s.activeProvider) // { type: 'seed-vc', endpoint: 'https://xxx.gradio.live' }
 * const adapter = createSeedVCAdapter(provider)
 * await adapter.connect();
 * ```
 */
export function createSeedVCAdapter(
  provider: { endpoint: string; apiKey?: string },
  config?: Partial<Omit<SeedVCConfig, 'endpoint' | 'apiKey'>>
): SeedVCAdapter {
  return new SeedVCAdapter({
    endpoint: provider.endpoint,
    apiKey: provider.apiKey,
    ...config,
  })
}
