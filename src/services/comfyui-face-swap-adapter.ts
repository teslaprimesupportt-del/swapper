/**
 * ComfyUI Face Swap Adapter
 *
 * Connects to a ComfyUI instance running the ReActor face swap node.
 * ComfyUI uses its own REST API (not Gradio):
 *
 *   GET  /system_stats              → health check / queue status
 *   GET  /object_info/ReActor        → discover ReActor node parameters
 *   POST /prompt                    → submit a workflow with input images
 *   GET  /history/{prompt_id}       → poll for completion
 *   GET  /view?filename=xxx&type=output → download result image
 *   WS   ws://host/ws?clientId=xxx   → real-time progress (optional)
 *
 * Architecture:
 *   1. User provides reference face image (the face to swap ONTO)
 *   2. Each video frame from webcam is the SOURCE image
 *   3. ComfyUI runs: detect face in source → replace with reference face
 *   4. Result image is returned and drawn to canvas
 *
 * For the default ReActor workflow, the key nodes are:
 *   - LoadImage (reference face)
 *   - LoadImage (source frame from webcam)  
 *   - ReActorFaceSwap
 *   - SaveImage/PreviewImage
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ComfyUIConfig {
  /** ComfyUI endpoint URL, e.g. "http://127.0.0.1:8188" */
  endpoint: string
  /** Optional API key */
  apiKey?: string
  /** Client ID for WebSocket communication */
  clientId: string
}

export interface FaceSwapAdapterState {
  status: 'disconnected' | 'connecting' | 'connected' | 'swapping' | 'error'
  latency: number
  errorMessage: string | null
  framesProcessed: number
  hasReferenceFace: boolean
  referenceFaceDataUrl: string | null
  queueSize: number
}

export type FaceSwapEventCallback = (state: Partial<FaceSwapAdapterState>) => void

// ─── ComfyUI API Types ─────────────────────────────────────────────────────

interface ComfyUIPromptResponse {
  prompt_id: string
  number: number
  node_errors?: Record<string, unknown>
}

interface ComfyUIHistoryOutput {
  outputs?: Record<string, {
    images?: Array<{ filename: string; subfolder: string; type: string }>
  }>
  status?: {
    completed?: boolean
    status_str?: string
  }
}

interface ComfyUISystemStats {
  system?: {
    devices?: Array<{
      name: string
      type: string
      vram_total?: number
      vram_free?: number
    }>
  }
  queue?: {
    running: Array<{ prompt_id: string }>
    pending: number
  }
}

// ─── Default ReActor Workflow Template ─────────────────────────────────────

/**
 * A minimal ComfyUI workflow for ReActor face swap.
 * This template has two image inputs that we fill dynamically:
 *   - Node 1: Reference face (the face to apply)
 *   - Node 2: Source image (the webcam frame)
 *   - Node 3: ReActorFaceSwap node
 *   - Node 4: PreviewImage (output)
 *
 * Node IDs must match the workflow. The adapter fills in the image data
 * at nodes 1 and 2 before each prompt submission.
 */
const DEFAULT_REACTOR_WORKFLOW = {
  '3': {
    class_type: 'ReActorFaceSwap',
    inputs: {
      input_image: ['2', 0],
      source_image: ['1', 0],
      swap_model: 'inswapper_128.onnx',
      facedetection: 'retinaface_resnet50',
      face_restore_model: 'GFPGANv1.4',
      face_restore_visibility: 1,
      codeformer_weight: 0.5,
      detect_gender_input: 'no',
      detect_gender_source: 'no',
      source_faces_index: '0',
      input_faces_index: '0',
      console_log_level: 1,
      multiple_faces: false,
      boost_range: false,
    },
  },
  '2': {
    class_type: 'LoadImage',
    inputs: {
      image: '', // Filled dynamically: base64 of webcam frame
    },
  },
  '1': {
    class_type: 'LoadImage',
    inputs: {
      image: '', // Filled dynamically: base64 of reference face
    },
  },
  '4': {
    class_type: 'PreviewImage',
    inputs: {
      images: ['3', 0],
    },
  },
}

// ─── Adapter Class ──────────────────────────────────────────────────────────

export class ComfyUIFaceSwapAdapter {
  private config: ComfyUIConfig
  private state: FaceSwapAdapterState
  private listeners: Set<FaceSwapEventCallback> = new Set()
  private abortController: AbortController | null = null
  private isProcessing: boolean = false
  private customWorkflow: Record<string, unknown> | null = null

  constructor(config: Partial<ComfyUIConfig> & { endpoint: string }) {
    this.config = {
      ...config,
      clientId: config.clientId || crypto.randomUUID(),
    }
    this.state = {
      status: 'disconnected',
      latency: 0,
      errorMessage: null,
      framesProcessed: 0,
      hasReferenceFace: false,
      referenceFaceDataUrl: null,
      queueSize: 0,
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Connect to ComfyUI and verify it's running.
   * Checks /system_stats for a valid response.
   */
  async connect(): Promise<void> {
    this.updateState({ status: 'connecting', errorMessage: null })

    try {
      const stats = await this.fetchSystemStats()
      this.updateState({
        status: 'connected',
        queueSize: stats.queue?.pending ?? 0,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect to ComfyUI'
      this.updateState({ status: 'error', errorMessage: message })
      throw err
    }
  }

  /**
   * Disconnect and reset state.
   */
  disconnect(): void {
    this.cancelPendingRequests()
    this.updateState({
      status: 'disconnected',
      queueSize: 0,
    })
  }

  /**
   * Test the connection. Returns health info.
   */
  async testConnection(): Promise<{ success: boolean; latency: number; info?: string }> {
    const startTime = performance.now()
    try {
      const stats = await this.fetchSystemStats()
      const latency = Math.round(performance.now() - startTime)
      const deviceInfo = stats.system?.devices?.[0]
      const info = deviceInfo
        ? `${deviceInfo.name} (${deviceInfo.type})`
        : 'CPU mode'
      this.updateState({ status: 'connected', latency })
      return { success: true, latency, info }
    } catch (err) {
      const latency = Math.round(performance.now() - startTime)
      const message = err instanceof Error ? err.message : 'Connection failed'
      this.updateState({ status: 'error', errorMessage: message })
      return { success: false, latency, info: message }
    }
  }

  /**
   * Set the reference face image (the face to swap ONTO the source).
   * Accepts a data URL (base64-encoded image), a File, or a Blob.
   */
  async setReferenceFace(input: string | File | Blob): Promise<void> {
    let dataUrl: string

    if (typeof input === 'string') {
      dataUrl = input
    } else {
      dataUrl = await this.fileToDataUrl(input)
    }

    this.updateState({
      hasReferenceFace: true,
      referenceFaceDataUrl: dataUrl,
    })
  }

  /**
   * Clear the reference face.
   */
  clearReferenceFace(): void {
    this.updateState({
      hasReferenceFace: false,
      referenceFaceDataUrl: null,
    })
  }

  /**
   * Capture a reference face from a video element (webcam).
   * Takes a snapshot of the current frame, optionally cropped to center.
   */
  captureReferenceFromVideo(videoElement: HTMLVideoElement): string {
    const canvas = document.createElement('canvas')
    const size = Math.min(videoElement.videoWidth, videoElement.videoHeight)
    canvas.width = size
    canvas.height = size

    const ctx = canvas.getContext('2d')!
    // Center crop the video frame to a square
    const sx = (videoElement.videoWidth - size) / 2
    const sy = (videoElement.videoHeight - size) / 2
    ctx.drawImage(videoElement, sx, sy, size, size, 0, 0, size, size)

    const dataUrl = canvas.toDataURL('image/png')
    this.updateState({
      hasReferenceFace: true,
      referenceFaceDataUrl: dataUrl,
    })
    return dataUrl
  }

  /**
   * Swap a single frame. Takes the source frame as a data URL or canvas/video element,
   * sends it to ComfyUI with the reference face, returns the swapped image as a Blob.
   *
   * This is called per-frame from the face swap pipeline.
   */
  async swapFrame(sourceInput: string | HTMLVideoElement | HTMLCanvasElement): Promise<Blob> {
    if (this.state.status !== 'connected' && this.state.status !== 'swapping') {
      throw new Error('Not connected. Call connect() first.')
    }
    if (!this.state.referenceFaceDataUrl) {
      throw new Error('No reference face set. Call setReferenceFace() first.')
    }
    if (this.isProcessing) {
      throw new Error('Already processing a frame. Wait for the previous swap to complete.')
    }

    this.isProcessing = true
    this.updateState({ status: 'swapping' })

    try {
      const startTime = performance.now()

      // Convert source input to data URL
      const sourceDataUrl = typeof sourceInput === 'string'
        ? sourceInput
        : this.elementToDataUrl(sourceInput)

      // Build the workflow with both images
      const workflow = this.buildWorkflow(sourceDataUrl, this.state.referenceFaceDataUrl)

      // Submit to ComfyUI
      const promptId = await this.submitPrompt(workflow)

      // Poll for completion
      const outputFilename = await this.pollForResult(promptId)

      // Download the result image
      const resultBlob = await this.downloadOutput(outputFilename)

      const endTime = performance.now()
      this.updateState({
        latency: Math.round(endTime - startTime),
        framesProcessed: this.state.framesProcessed + 1,
      })

      return resultBlob
    } finally {
      this.isProcessing = false
      const currentStatus = this.state.status as FaceSwapAdapterState['status']
      if (currentStatus === 'swapping') {
        this.updateState({ status: 'connected' })
      }
    }
  }

  /**
   * Set a custom workflow template (exported from ComfyUI UI).
   * The adapter will fill in image inputs at LoadImage nodes.
   */
  setCustomWorkflow(workflow: Record<string, unknown>): void {
    this.customWorkflow = workflow
  }

  /**
   * Update configuration.
   */
  updateConfig(partial: Partial<ComfyUIConfig>): void {
    this.config = { ...this.config, ...partial }
  }

  /** Get current state */
  getState(): FaceSwapAdapterState {
    return { ...this.state }
  }

  /** Get current config */
  getConfig(): ComfyUIConfig {
    return { ...this.config }
  }

  /** Subscribe to state changes */
  onStateChange(callback: FaceSwapEventCallback): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  // ─── Private Methods ─────────────────────────────────────────────────────

  private updateState(partial: Partial<FaceSwapAdapterState>): void {
    this.state = { ...this.state, ...partial }
    this.listeners.forEach((listener) => {
      try { listener(partial) } catch (e) {
        console.error('[ComfyUIAdapter] listener error:', e)
      }
    })
  }

  private getBaseUrl(): string {
    return this.config.endpoint.replace(/\/+$/, '')
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Accept': 'application/json' }
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

  private async fetchSystemStats(): Promise<ComfyUISystemStats> {
    const url = `${this.getBaseUrl()}/system_stats`
    const resp = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: this.getSignal(),
    })
    if (!resp.ok) {
      throw new Error(`ComfyUI /system_stats failed: ${resp.status} ${resp.statusText}`)
    }
    return resp.json()
  }

  /**
   * Build the workflow JSON with source and reference images.
   * Uses the custom workflow if set, otherwise the default ReActor template.
   */
  private buildWorkflow(sourceDataUrl: string, referenceDataUrl: string): Record<string, unknown> {
    const template = this.customWorkflow || DEFAULT_REACTOR_WORKFLOW

    // Deep clone to avoid mutating the template
    const workflow = JSON.parse(JSON.stringify(template)) as Record<string, Record<string, unknown>>

    // Find LoadImage nodes and fill them
    // Convention: first LoadImage = reference face, second = source frame
    const loadImageNodes: string[] = []
    for (const [nodeId, node] of Object.entries(workflow)) {
      if (node.class_type === 'LoadImage') {
        loadImageNodes.push(nodeId)
      }
    }

    if (loadImageNodes.length >= 2) {
      // First LoadImage = reference face (source_image in ReActor terms)
      const node0 = workflow[loadImageNodes[0]] as Record<string, unknown>
      node0.inputs = { ...(node0.inputs as Record<string, unknown>), image: referenceDataUrl }
      // Second LoadImage = source frame (input_image in ReActor terms)
      const node1 = workflow[loadImageNodes[1]] as Record<string, unknown>
      node1.inputs = { ...(node1.inputs as Record<string, unknown>), image: sourceDataUrl }
    } else if (loadImageNodes.length === 1) {
      // Only one LoadImage — fill it with the source frame
      const node0 = workflow[loadImageNodes[0]] as Record<string, unknown>
      node0.inputs = { ...(node0.inputs as Record<string, unknown>), image: sourceDataUrl }
    }

    return workflow
  }

  /**
   * Submit a workflow prompt to ComfyUI.
   */
  private async submitPrompt(workflow: Record<string, unknown>): Promise<string> {
    const url = `${this.getBaseUrl()}/prompt`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: workflow,
        client_id: this.config.clientId,
      }),
      signal: this.getSignal(),
    })

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => 'Unknown error')
      throw new Error(`ComfyUI /prompt failed (${resp.status}): ${errorText}`)
    }

    const data = await resp.json() as ComfyUIPromptResponse

    if (data.node_errors && Object.keys(data.node_errors).length > 0) {
      const errors = Object.entries(data.node_errors)
        .map(([nodeId, err]) => `Node ${nodeId}: ${JSON.stringify(err)}`)
        .join('; ')
      throw new Error(`Workflow node errors: ${errors}`)
    }

    return data.prompt_id
  }

  /**
   * Poll the history endpoint until the prompt completes.
   */
  private async pollForResult(promptId: string): Promise<{ filename: string; subfolder: string; type: string }> {
    const url = `${this.getBaseUrl()}/history/${promptId}`
    const maxPollTime = 60_000 // 60s timeout (CPU can be slow)
    const pollInterval = 500
    const startTime = Date.now()

    while (Date.now() - startTime < maxPollTime) {
      const resp = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: this.getSignal(),
      })

      if (!resp.ok) {
        // History might not exist yet, keep polling
        await new Promise((r) => setTimeout(r, pollInterval))
        continue
      }

      const history = (await resp.json()) as Record<string, ComfyUIHistoryOutput>
      const entry = history[promptId] as ComfyUIHistoryOutput | undefined

      if (!entry) {
        await new Promise((r) => setTimeout(r, pollInterval))
        continue
      }

      // Check if completed
      if (entry.status?.completed) {
        // Extract the output image info
        const outputs = entry.outputs ?? {}
        for (const nodeId of Object.keys(outputs)) {
          const output = outputs[nodeId]
          if (output?.images && output.images.length > 0) {
            return output.images[0]
          }
        }
        throw new Error('Prompt completed but no output image found')
      }

      if (entry.status?.status_str === 'error') {
        throw new Error('ComfyUI workflow execution failed')
      }

      await new Promise((r) => setTimeout(r, pollInterval))
    }

    throw new Error(`Face swap timed out after ${maxPollTime / 1000}s`)
  }

  /**
   * Download the output image from ComfyUI.
   */
  private async downloadOutput(imageInfo: { filename: string; subfolder: string; type: string }): Promise<Blob> {
    const params = new URLSearchParams({
      filename: imageInfo.filename,
      subfolder: imageInfo.subfolder,
      type: imageInfo.type,
    })
    const url = `${this.getBaseUrl()}/view?${params}`

    const resp = await fetch(url, {
      headers: this.getHeaders(),
      signal: this.getSignal(),
    })

    if (!resp.ok) {
      throw new Error(`Failed to download output image: ${resp.status}`)
    }

    return resp.blob()
  }

  /**
   * Convert a video or canvas element to a data URL (JPEG for speed).
   */
  private elementToDataUrl(element: HTMLVideoElement | HTMLCanvasElement): string {
    const canvas = document.createElement('canvas')
    // Use a reasonable size for face swap (640x640 is plenty)
    const maxSize = 640
    let width: number
    let height: number

    if (element instanceof HTMLVideoElement) {
      width = element.videoWidth
      height = element.videoHeight
    } else {
      width = element.width
      height = element.height
    }

    // Scale down if needed
    if (width > maxSize || height > maxSize) {
      const scale = maxSize / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }

    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(element, 0, 0, width, height)

    return canvas.toDataURL('image/jpeg', 0.85)
  }

  /**
   * Convert a File/Blob to a data URL.
   */
  private fileToDataUrl(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a ComfyUI face swap adapter from a provider config.
 */
export function createFaceSwapAdapter(
  provider: { endpoint: string; apiKey?: string },
  config?: Partial<Omit<ComfyUIConfig, 'endpoint' | 'apiKey'>>
): ComfyUIFaceSwapAdapter {
  return new ComfyUIFaceSwapAdapter({
    endpoint: provider.endpoint,
    apiKey: provider.apiKey,
    ...config,
  })
}
