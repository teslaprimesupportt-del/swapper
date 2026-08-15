import { NextRequest, NextResponse } from 'next/server'

const COMFYUI_URL = 'http://127.0.0.1:8188'

/**
 * Catch-all proxy route: /api/comfyui/* → http://127.0.0.1:8188/*
 *
 * This lets the browser reach the face swap server running inside
 * the sandbox through the Next.js preview URL.
 *
 * The Studio's ComfyUI adapter should be configured with
 * endpoint: "https://preview-xxx.space-z.ai/api/comfyui"
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const url = new URL(request.url)
  const search = url.search
  const target = `${COMFYUI_URL}/${path.join('/')}${search}`

  try {
    const resp = await fetch(target, {
      headers: { Accept: 'application/json, image/*' },
      signal: AbortSignal.timeout(30_000),
    })

    const contentType = resp.headers.get('content-type') || ''

    if (contentType.startsWith('image/')) {
      const blob = await resp.blob()
      return new NextResponse(blob, {
        status: resp.status,
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
      })
    }

    const data = await resp.json()
    return NextResponse.json(data, { status: resp.status })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Proxy error' },
      { status: 502 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const target = `${COMFYUI_URL}/${path.join('/')}`

  try {
    const body = await request.text()
    const resp = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
      signal: AbortSignal.timeout(30_000),
    })

    const data = await resp.json()
    return NextResponse.json(data, { status: resp.status })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Proxy error' },
      { status: 502 }
    )
  }
}
