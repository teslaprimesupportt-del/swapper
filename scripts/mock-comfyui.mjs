// Mock ComfyUI server for testing the face swap pipeline.
// Simulates: GET /system_stats, POST /prompt, GET /history/:id, GET /view
// Returns a colored PNG as the "swapped" image.
// Usage: node scripts/mock-comfyui.mjs

import { createServer } from 'http'
import { deflateSync } from 'zlib'
import { randomUUID } from 'crypto'

const PORT = 8189
const PROMPT_RESULTS = new Map()

// ── PNG encoder (no dependencies) ──

function crc32(buf) {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c
  }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function makeChunk(type, data) {
  const typeB = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])), 0)
  return Buffer.concat([len, typeB, data, crcB])
}

function generateMockPng() {
  const W = 640, H = 480
  const raw = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      raw[i]   = Math.floor(80 + (x / W) * 60)   // R
      raw[i+1] = Math.floor(40 + (y / H) * 80)   // G
      raw[i+2] = Math.floor(160 + (x / W) * 60)  // B
      raw[i+3] = 255
    }
  }
  // Add a white rectangle in center as "face region" indicator
  const cx = W/2, cy = H/2, rw = 120, rh = 150
  for (let y = Math.floor(cy-rh/2); y < Math.floor(cy+rh/2); y++) {
    for (let x = Math.floor(cx-rw/2); x < Math.floor(cx+rw/2); x++) {
      if (x >= 0 && x < W && y >= 0 && y < H) {
        const i = (y * W + x) * 4
        raw[i] = 200; raw[i+1] = 180; raw[i+2] = 255; raw[i+3] = 255
      }
    }
  }

  // Add filter byte (0=None) before each row
  const filtered = Buffer.alloc(H * (W * 4 + 1))
  for (let y = 0; y < H; y++) {
    filtered[y * (W * 4 + 1)] = 0
    raw.copy(filtered, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
  }
  const compressed = deflateSync(filtered)

  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8]=8; ihdr[9]=6 // 8-bit RGBA

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]), // PNG sig
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ])
}

// ── HTTP Server ──

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // GET /system_stats
  if (req.method === 'GET' && url.pathname === '/system_stats') {
    console.log('[Mock] GET /system_stats')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      system: { devices: [{ name: 'Mock CPU', type: 'cpu', vram_total: 0, vram_free: 0 }] },
      queue: { running: [], pending: 0 },
    }))
    return
  }

  // POST /prompt
  if (req.method === 'POST' && url.pathname === '/prompt') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const promptId = randomUUID()
      console.log(`[Mock] POST /prompt → ${promptId.slice(0,8)}`)
      setTimeout(() => {
        PROMPT_RESULTS.set(promptId, {
          status: { completed: true, status_str: 'success' },
          outputs: { '4': { images: [{ filename: `swap_${Date.now()}.png`, subfolder: '', type: 'output' }] } },
        })
        console.log(`[Mock] Prompt ${promptId.slice(0,8)} completed`)
      }, 250) // 250ms simulated processing
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ prompt_id: promptId, number: Date.now() }))
    })
    return
  }

  // GET /history/:id
  if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
    const pid = decodeURIComponent(url.pathname.slice('/history/'.length))
    const r = PROMPT_RESULTS.get(pid)
    console.log(`[Mock] GET /history/${pid.slice(0,8)} → ${r ? 'done' : 'pending'}`)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(r ? { [pid]: r } : {}))
    return
  }

  // GET /view
  if (req.method === 'GET' && url.pathname === '/view') {
    const fn = url.searchParams.get('filename') || 'unknown'
    console.log(`[Mock] GET /view?filename=${fn}`)
    const png = generateMockPng()
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
    res.end(png)
    return
  }

  console.log(`[Mock] ${req.method} ${url.pathname} → 404`)
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Mock ComfyUI running on http://0.0.0.0:${PORT}`)
  console.log(`  Add as Face Swap provider: http://127.0.0.1:${PORT}\n`)
})
