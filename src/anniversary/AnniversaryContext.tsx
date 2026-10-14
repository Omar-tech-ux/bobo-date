import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useOnline } from '../online/OnlineContext'
import { cleanupUnusedUploads, errorMessage, readStatus } from './api'
import type { AnniversaryIdentity, AnniversaryStatus } from './types'

type AnniversaryContextValue = {
  identity: AnniversaryIdentity | null
  status: AnniversaryStatus | null
  error: string
  version: number
  refresh: () => Promise<void>
  changed: () => void
  promptHandled: boolean
  handlePrompt: () => void
}
const AnniversaryContext = createContext<AnniversaryContextValue | null>(null)

export function AnniversarySession({ children }: { children: ReactNode }) {
  const { configured, loading, user, pairing } = useOnline()
  const ready = configured && !loading && user && pairing.coupleId && pairing.partner
  const userId = ready ? user.id : ''
  const coupleId = ready ? pairing.coupleId! : ''
  return <AnniversaryProvider key={`${userId}:${coupleId}`} userId={userId} coupleId={coupleId}>{children}</AnniversaryProvider>
}

function AnniversaryProvider({ userId, coupleId, children }: { userId: string; coupleId: string; children: ReactNode }) {
  const identity = useMemo(() => userId && coupleId ? { userId, coupleId } : null, [userId, coupleId])
  const [status, setStatus] = useState<AnniversaryStatus | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [promptHandled, setPromptHandled] = useState(false)
  const generation = useRef(0)
  const mounted = useRef(false)
  const checkedLaunch = useRef(false)

  const refresh = useCallback(async () => {
    if (!identity) return
    const request = ++generation.current
    try {
      const next = await readStatus()
      if (mounted.current && request === generation.current) {
        setStatus(next)
        setError('')
        if (!checkedLaunch.current) {
          checkedLaunch.current = true
          if (!next.latest_date || next.completed_at) setPromptHandled(true)
        }
      }
    } catch (failure) {
      if (mounted.current && request === generation.current) setError(errorMessage(failure))
    }
  }, [identity])

  useEffect(() => {
    mounted.current = true
    void refresh()
    // Deferred work is cancelled during StrictMode's initial effect replay.
    const cleanupTimer = window.setTimeout(() => {
      if (identity) void cleanupUnusedUploads().catch(() => { /* Retry on the next online launch. */ })
    }, 1000)
    const revalidate = () => {
      if (document.visibilityState === 'hidden') return
      void refresh()
      setVersion((value) => value + 1)
    }
    document.addEventListener('visibilitychange', revalidate)
    window.addEventListener('online', revalidate)
    return () => {
      mounted.current = false
      ++generation.current
      window.clearTimeout(cleanupTimer)
      document.removeEventListener('visibilitychange', revalidate)
      window.removeEventListener('online', revalidate)
    }
  }, [identity, refresh])

  const changed = useCallback(() => {
    if (!mounted.current) return
    // A successful edit must never cause a second launch popup in this session.
    setPromptHandled(true)
    setVersion((value) => value + 1)
    void refresh()
    void cleanupUnusedUploads().catch(() => {})
  }, [refresh])
  const handlePrompt = useCallback(() => setPromptHandled(true), [])
  const value = useMemo(() => ({ identity, status, error, version, refresh, changed, promptHandled, handlePrompt }),
    [identity, status, error, version, refresh, changed, promptHandled, handlePrompt])
  return <AnniversaryContext.Provider value={value}>{children}</AnniversaryContext.Provider>
}

export function useAnniversary() {
  const context = useContext(AnniversaryContext)
  if (!context) throw new Error('AnniversarySession is required.')
  return context
}
