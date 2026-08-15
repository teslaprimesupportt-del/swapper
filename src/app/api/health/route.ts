import { NextResponse } from 'next/server'

// Railway health check endpoint.
// Returns 200 with a simple JSON body so Railway's
// load balancer knows the container is healthy.
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
