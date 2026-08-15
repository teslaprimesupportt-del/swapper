#!/bin/sh
# Start script for Railway deployment
# HOSTNAME=0.0.0.0: Railway sets HOSTNAME to a container ID which
#   Next.js standalone can't bind to. Override with 0.0.0.0.
# PORT: Do NOT set. Railway provides its own PORT env var
#   and the Next.js standalone server reads it automatically.
export HOSTNAME="0.0.0.0"
exec bun .next/standalone/server.js
