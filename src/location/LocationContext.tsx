import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useOnline } from '../online/OnlineContext'
import { locationApi } from './api'
import { LocationController } from './controller'
import type { LocationView } from './types'

type LocationContextValue = LocationView & Pick<LocationController, 'startSharing' | 'stopSharing' | 'updateLocation' | 'registerSurface'>
const LocationContext = createContext<LocationContextValue | null>(null)
const emptyView: LocationView = { available: false, loading: false, states: [], sharing: false, busy: false, pendingStop: false, visible: true, now: 0, error: '' }
const noop = () => {}
const emptyValue: LocationContextValue = { ...emptyView, startSharing: async () => {}, stopSharing: async () => {}, updateLocation: noop, registerSurface: () => noop }
const browserStorage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
  removeItem: (key: string) => window.localStorage.removeItem(key),
}

export function LocationSession({ children }: { children: ReactNode }) {
  const { configured, loading, user, pairing } = useOnline()
  const ready = configured && !loading && user && pairing.coupleId && pairing.partner
  return ready
    ? <LocationProvider key={`${user.id}:${pairing.coupleId}`} userId={user.id} coupleId={pairing.coupleId!}>{children}</LocationProvider>
    : <LocationContext.Provider value={emptyValue}>{children}</LocationContext.Provider>
}

function LocationProvider({ userId, coupleId, children }: { userId: string; coupleId: string; children: ReactNode }) {
  const [controller] = useState(() => new LocationController({ userId, coupleId, api: locationApi, geolocation: navigator.geolocation, storage: browserStorage }))
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => {
    const sync = () => controller.setEnvironment(document.visibilityState === 'visible', navigator.onLine)
    const hide = () => controller.setEnvironment(false, navigator.onLine)
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === `bobo-location:v1:${userId}:${coupleId}`) controller.syncPreferences()
    }
    sync()
    controller.start()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', sync)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    window.addEventListener('storage', storageChanged)
    return () => {
      controller.destroy()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', sync)
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
      window.removeEventListener('storage', storageChanged)
    }
  }, [controller, userId, coupleId])
  const value = useMemo(() => ({ ...state,
    startSharing: controller.startSharing, stopSharing: controller.stopSharing,
    updateLocation: controller.updateLocation, registerSurface: controller.registerSurface,
  }), [controller, state])
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>
}

export function useLocation() {
  const value = useContext(LocationContext)
  if (!value) throw new Error('LocationSession is required.')
  return value
}
