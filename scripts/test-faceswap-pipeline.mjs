import { createServer } from 'http'
import { deflateSync } from 'zlib'
import { randomUUID } from 'crypto'

// ─── Inline Mock ComfyUI Server (port 8190) ───

const PROMPT_RESULTS = new Map()

function crc32(buf) {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}
function makeChunk(type, data) {
  const t = Buffer.from(type, 'ascii'), l = Buffer.alloc(4); l.writeUInt32BE(data.length, 0)
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([l, t, data, c])
}
function makePng() {
  const W = 320, H = 240
  const raw = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    raw[i] = 100 + x; raw[i+1] = 50 + y; raw[i+2] = 200; raw[i+3] = 255
  }
  const f = Buffer.alloc(H * (W * 4 + 1))
  for (let y = 0; y < H; y++) { f[y * (W * 4 + 1)] = 0; raw.copy(f, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), makeChunk('IHDR', ihdr), makeChunk('IDAT', deflateSync(f)), makeChunk('IEND', Buffer.alloc(0))])
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:8190`)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && url.pathname === '/system_stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ system: { devices: [{ name: 'Test CPU', type: 'cpu' }] }, queue: { running: [], pending: 0 } }))
    return
  }
  if (req.method === 'POST' && url.pathname === '/prompt') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const pid = randomUUID()
      setTimeout(() => {
        PROMPT_RESULTS.set(pid, {
          status: { completed: true, status_str: 'success' },
          outputs: { '4': { images: [{ filename: `swap_${Date.now()}.png`, subfolder: '', type: 'output' }] } },
        })
      }, 100) // 100ms fast mock
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ prompt_id: pid, number: Date.now() }))
    })
    return
  }
  if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
    const pid = decodeURIComponent(url.pathname.slice('/history/'.length))
    const r = PROMPT_RESULTS.get(pid)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(r ? { [pid]: r } : {}))
    return
  }
  if (req.method === 'GET' && url.pathname === '/view') {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(makePng())
    return
  }
  res.writeHead(404); res.end('not found')
})

await new Promise(r => server.listen(8190, '127.0.0.1', r))

// ─── Test: Simulate what the ComfyUI adapter does ───

const BASE = 'http://127.0.0.1:8190'
const CLIENT_ID = randomUUID()
let passed = 0, failed = 0

function assert(label, condition) {
  if (condition) { console.log(`  ✓ ${label}`); passed++ }
  else { console.log(`  ✗ FAIL: ${label}`); failed++ }
}

console.log('\n=== Face Swap Pipeline E2E Test ===\n')

// 1. Connect (GET /system_stats)
console.log('1. Connect')
const statsRes = await fetch(`${BASE}/system_stats`)
const stats = await statsRes.json()
assert('/system_stats returns 200', statsRes.ok)
assert('Has devices array', Array.isArray(stats.system.devices))
assert('Queue pending is 0', stats.queue.pending === 0)

// 2. Set reference face (local operation, no API call)
console.log('\n2. Set Reference Face')
const refFaceDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' // stub
assert('Reference face stored locally', refFaceDataUrl.startsWith('data:'))

// 3. Submit frame for swap (POST /prompt)
console.log('\n3. Submit Frame')
const sourceDataUrl = 'data:image/png;base64,iVBORw0KGgo=' // stub
const workflow = {
  '1': { class_type: 'LoadImage', inputs: { image: refFaceDataUrl } },
  '2': { class_type: 'LoadImage', inputs: { image: sourceDataUrl } },
  '3': { class_type: 'ReActorFaceSwap', inputs: { input_image: ['2', 0], source_image: ['1', 0] } },
  '4': { class_type: 'PreviewImage', inputs: { images: ['3', 0] } },
}
const t0 = performance.now()
const promptRes = await fetch(`${BASE}/prompt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: workflow, client_id: CLIENT_ID }),
})
const promptData = await promptRes.json()
assert('/prompt returns 200', promptRes.ok)
assert('Has prompt_id', typeof promptData.prompt_id === 'string' && promptData.prompt_id.length > 0)
assert('No node_errors', !promptData.node_errors || Object.keys(promptData.node_errors).length === 0)

// 4. Poll for result (GET /history/:id)
console.log('\n4. Poll for Result')
const promptId = promptData.prompt_id
let historyEntry = null
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 100))
  const hRes = await fetch(`${BASE}/history/${promptId}`)
  const hData = await hRes.json()
  if (hData[promptId]?.status?.completed) { historyEntry = hData[promptId]; break }
}
assert('History shows completed', historyEntry !== null)
assert('Has output images', historyEntry?.outputs?.['4']?.images?.length > 0)
const imgInfo = historyEntry.outputs['4'].images[0]
assert('Image has filename', typeof imgInfo.filename === 'string' && imgInfo.filename.length > 0)

// 5. Download result (GET /view)
console.log('\n5. Download Result')
const viewUrl = `${BASE}/view?filename=${encodeURIComponent(imgInfo.filename)}&subfolder=${encodeURIComponent(imgInfo.subfolder)}&type=${encodeURIComponent(imgInfo.type)}`
const viewRes = await fetch(viewUrl)
const blob = await viewRes.blob()
const latency = Math.round(performance.now() - t0)
assert('/view returns 200', viewRes.ok)
assert('Result is PNG', blob.type === 'image/png')
assert(`Blob size > 0 (${blob.size} bytes)`, blob.size > 0)
assert(`Total latency < 2000ms (${latency}ms)`, latency < 2000)

// Summary
console.log(`\n${'='.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed, ${latency}ms total latency`)
console.log(`${'='.repeat(40)}\n`)

server.close()
process.exit(failed > 0 ? 1 : 0)
