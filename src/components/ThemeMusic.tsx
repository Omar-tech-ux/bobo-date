import { useEffect, useRef, useState } from 'react'
import { ThemeSongEngine, type InteractionSound, type ThemeMood } from '../audio/themeSong'

export const THEME_MUSIC_STORAGE_KEY = 'bobo-theme-music-v1'

function loadMutedPreference() {
  try {
    return window.localStorage.getItem(THEME_MUSIC_STORAGE_KEY) === 'muted'
  } catch {
    return false
  }
}

function saveMutedPreference(muted: boolean) {
  try {
    window.localStorage.setItem(THEME_MUSIC_STORAGE_KEY, muted ? 'muted' : 'playing')
  } catch {
    // Music still works when browser storage is unavailable.
  }
}

function moodForRoute(route: string): ThemeMood {
  if (route === '/world') return 'bright'
  if (route === '/scrapbook' || route === '/gallery-room') return 'dreamy'
  if (route === '/cinema') return 'cinema'
  return 'tender'
}

function interactionFor(target: HTMLElement): InteractionSound | undefined {
  const explicit = target.closest<HTMLElement>('[data-sound]')?.dataset.sound as InteractionSound | undefined
  if (explicit) return explicit
  if (target.closest('input[type="radio"]')) return 'select'
  if (target.closest('button, a, [role="button"]')) return 'tap'
  return undefined
}

export function ThemeMusic({ route }: { route: string }) {
  const engineRef = useRef<ThemeSongEngine | undefined>(undefined)
  const startedRef = useRef(false)
  const startingRef = useRef<Promise<boolean | undefined> | undefined>(undefined)
  const mutedRef = useRef(loadMutedPreference())
  const [started, setStarted] = useState(false)
  const [muted, setMuted] = useState(mutedRef.current)

  if (!engineRef.current) engineRef.current = new ThemeSongEngine()

  const begin = async () => {
    if (startedRef.current) return true
    if (mutedRef.current) return false
    if (!startingRef.current) startingRef.current = engineRef.current?.start()
    const didStart = await startingRef.current
    if (didStart) {
      if (!startedRef.current) {
        startedRef.current = true
        setStarted(true)
        engineRef.current?.setMood(moodForRoute(route))
      }
      return true
    }
    startingRef.current = undefined
    return false
  }

  useEffect(() => {
    const onFirstGesture = () => void begin()
    window.addEventListener('pointerdown', onFirstGesture, { capture: true })
    window.addEventListener('click', onFirstGesture, { capture: true })
    window.addEventListener('keydown', onFirstGesture, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture, { capture: true })
      window.removeEventListener('click', onFirstGesture, { capture: true })
      window.removeEventListener('keydown', onFirstGesture, { capture: true })
    }
  })

  useEffect(() => {
    const onInteraction = async (event: MouseEvent) => {
      if (mutedRef.current || !(event.target instanceof HTMLElement)) return
      const sound = interactionFor(event.target)
      if (!sound) return
      if (!startedRef.current) await begin()
      if (startedRef.current) engineRef.current?.playInteraction(sound)
    }
    window.addEventListener('click', onInteraction)
    return () => window.removeEventListener('click', onInteraction)
  }, [])

  useEffect(() => {
    engineRef.current?.setMood(moodForRoute(route))
  }, [route])

  useEffect(() => {
    const pause = () => engineRef.current?.setPausedForVideo(true)
    const resume = () => engineRef.current?.setPausedForVideo(false)
    window.addEventListener('bobo-cinema-play', pause)
    window.addEventListener('bobo-cinema-stop', resume)
    return () => {
      window.removeEventListener('bobo-cinema-play', pause)
      window.removeEventListener('bobo-cinema-stop', resume)
    }
  }, [])

  useEffect(() => {
    const syncVisibility = () => engineRef.current?.setPageHidden(document.hidden)
    document.addEventListener('visibilitychange', syncVisibility)
    return () => document.removeEventListener('visibilitychange', syncVisibility)
  }, [])

  useEffect(() => () => engineRef.current?.dispose(), [])

  const toggle = async () => {
    if (!startedRef.current) {
      mutedRef.current = false
      setMuted(false)
      saveMutedPreference(false)
      const didStart = await engineRef.current?.start()
      if (didStart) {
        startedRef.current = true
        setStarted(true)
        engineRef.current?.setMood(moodForRoute(route))
      }
      return
    }

    const nextMuted = !mutedRef.current
    mutedRef.current = nextMuted
    setMuted(nextMuted)
    engineRef.current?.setMuted(nextMuted)
    saveMutedPreference(nextMuted)
  }

  const isPlaying = started && !muted
  const label = !started
    ? muted ? 'Turn on Across the Pink Sky' : 'Start Across the Pink Sky'
    : muted ? 'Turn theme music on' : 'Mute theme music'

  return (
    <div className={`theme-music${isPlaying ? ' theme-music--playing' : ''}`}>
      <span className='theme-music-title' aria-hidden='true'>Across the Pink Sky</span>
      <button className='theme-music-button' type='button' onClick={toggle} aria-label={label} title={label}>
        <span className='theme-note' aria-hidden='true'>♫</span>
        <span className='theme-bars' aria-hidden='true'><i /><i /><i /></span>
        {muted && <i className='theme-muted-mark' aria-hidden='true' />}
      </button>
    </div>
  )
}
