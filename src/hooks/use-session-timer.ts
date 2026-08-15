'use client'

import { useEffect, useRef } from 'react'
import { useStudioStore } from '@/stores/studio-store'

export function useSessionTimer() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const durationRef = useRef(0)
  const sessionStatus = useStudioStore((s) => s.sessionStatus)
  const setSessionDuration = useStudioStore((s) => s.setSessionDuration)

  useEffect(() => {
    if (sessionStatus === 'active') {
      durationRef.current = 0
      timerRef.current = setInterval(() => {
        durationRef.current += 1
        setSessionDuration(durationRef.current)
      }, 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [sessionStatus, setSessionDuration])

  return null
}
