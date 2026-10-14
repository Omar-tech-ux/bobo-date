import { LocationApiError } from './api'
import { hasMoved } from './distance'
import type { LocationApi, LocationFix, LocationSnapshot, LocationState, LocationView } from './types'

const MINUTE = 60_000
const OFFLINE_MESSAGE = 'You’re offline. Location updates will resume when this app is open and connected.'
const READ_ERROR = 'Could not refresh locations. We’ll try again while the app is open.'
export const LOCATION_OPTIONS: PositionOptions = { enableHighAccuracy: false, maximumAge: MINUTE, timeout: 10_000 }
type Preferences = { revision: number | null; pendingStop: boolean; lastAttemptAt: number }
type Dependencies = {
  userId: string
  coupleId: string
  api: LocationApi
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  now?: () => number
}

/** One foreground collector per authenticated session; coordinates only live in memory. */
export class LocationController {
  private readonly key: string
  private readonly clock: () => number
  private preferences: Preferences
  private view: LocationView
  private listeners = new Set<() => void>()
  private active = false
  private online = true
  private generation = 0
  private environmentGeneration = 0
  private serverOffset = 0
  private ownRevision: number | null = null
  private surfaces = 0
  private readPromise: Promise<LocationSnapshot | undefined> | undefined
  private acquiring = false
  private writing = false
  private actionBusy = false
  private stopping = false
  private nextAttemptAt = 0
  private nextUploadAt = 0
  private previousFix: LocationFix | null = null
  private uploadedFix: LocationFix | null = null
  private stationaryReadings = 0
  private failures = 0
  private collectionTimer: ReturnType<typeof setTimeout> | undefined
  private readTimer: ReturnType<typeof setTimeout> | undefined
  private expiryTimer: ReturnType<typeof setTimeout> | undefined
  private stopTimer: ReturnType<typeof setTimeout> | undefined
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly deps: Dependencies) {
    this.clock = deps.now ?? Date.now
    this.key = `bobo-location:v1:${deps.userId}:${deps.coupleId}`
    this.preferences = this.readPreferences()
    this.nextAttemptAt = this.preferences.lastAttemptAt ? this.preferences.lastAttemptAt + 2 * MINUTE : 0
    this.view = {
      available: false, loading: true, states: [], sharing: false, busy: false,
      pendingStop: this.preferences.pendingStop, visible: true, now: this.clock(), error: '',
    }
  }

  getSnapshot = (): LocationView => this.view
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  private readPreferences(): Preferences {
    try {
      const raw = JSON.parse(this.deps.storage.getItem(this.key) ?? 'null') as Partial<Preferences> | null
      return {
        revision: Number.isSafeInteger(raw?.revision) && raw!.revision! >= 0 ? raw!.revision! : null,
        pendingStop: raw?.pendingStop === true,
        lastAttemptAt: typeof raw?.lastAttemptAt === 'number' && Number.isFinite(raw.lastAttemptAt)
          && raw.lastAttemptAt <= this.clock() ? raw.lastAttemptAt : 0,
      }
    } catch { return { revision: null, pendingStop: false, lastAttemptAt: 0 } }
  }

  private savePreferences() {
    try { this.deps.storage.setItem(this.key, JSON.stringify(this.preferences)) } catch {
      // Storage can be unavailable in private browsing; session sharing still works.
    }
  }

  private update(patch: Partial<LocationView> = {}) {
    const now = this.clock() + this.serverOffset
    const states = (patch.states ?? this.view.states).map((state) => state.expires_at
      && Date.parse(state.expires_at) <= now ? { ...state, latitude: null, longitude: null, accuracy: null, observed_at: null, expires_at: null } : state)
    this.view = {
      ...this.view, ...patch, states, now,
      busy: this.actionBusy || this.acquiring || this.writing,
      pendingStop: this.preferences.pendingStop,
    }
    this.listeners.forEach((listener) => listener())
    clearTimeout(this.expiryTimer)
    if (this.active && this.view.visible) {
      const expiries = states.flatMap((state) => state.expires_at ? [Date.parse(state.expires_at)] : [])
      const deadline = Math.min(...expiries, ...(this.surfaces ? [now + MINUTE] : []))
      if (Number.isFinite(deadline)) this.expiryTimer = setTimeout(() => this.update(), Math.max(1, deadline - now))
    }
  }

  start = () => {
    if (this.active) return
    this.active = true
    void this.resume()
  }

  destroy = () => {
    this.active = false
    ++this.generation
    ++this.environmentGeneration
    clearTimeout(this.collectionTimer)
    clearTimeout(this.readTimer)
    clearTimeout(this.expiryTimer)
    clearTimeout(this.stopTimer)
    clearTimeout(this.recoveryTimer)
    this.actionBusy = false
    this.readPromise = undefined
    this.previousFix = null
    this.uploadedFix = null
    this.view = { ...this.view, states: [], sharing: false }
  }

  setEnvironment = (visible: boolean, online: boolean) => {
    if (visible === this.view.visible && online === this.online) return
    ++this.environmentGeneration
    this.online = online
    this.readPromise = undefined
    clearTimeout(this.collectionTimer)
    clearTimeout(this.readTimer)
    clearTimeout(this.stopTimer)
    clearTimeout(this.recoveryTimer)
    this.update({ visible, sharing: visible && online ? this.view.sharing : this.preferences.revision !== null,
      error: !online ? OFFLINE_MESSAGE : this.view.error === OFFLINE_MESSAGE ? '' : this.view.error })
    if (this.active && visible && online) void this.resume()
  }

  private async resume() {
    if (!this.active || !this.view.visible || !this.online) return
    if (this.preferences.pendingStop) await this.flushStop()
    if (!this.active || this.preferences.pendingStop) return
    const snapshot = await this.refresh()
    if (!snapshot && this.active && this.online && this.view.visible && this.preferences.revision !== null) {
      this.recoveryTimer = setTimeout(() => { void this.resume() }, 2 * MINUTE)
    }
    this.scheduleCollection()
  }

  /** Revocations propagate across tabs; another tab cannot opt this tab in. */
  syncPreferences = () => {
    const saved = this.readPreferences()
    if (saved.pendingStop) {
      ++this.generation
      ++this.environmentGeneration
      this.readPromise = undefined
      this.actionBusy = false
      this.preferences = { ...saved, revision: null }
      clearTimeout(this.collectionTimer)
      this.update({ sharing: false, states: this.view.states.map((state) => state.user_id === this.deps.userId
        ? { ...state, sharing_enabled: false, latitude: null, longitude: null, accuracy: null, observed_at: null, expires_at: null } : state) })
      void this.flushStop()
    } else if (this.preferences.revision !== null && saved.revision !== this.preferences.revision) {
      ++this.environmentGeneration
      this.preferences.revision = null
      clearTimeout(this.collectionTimer)
      this.update({ sharing: false })
      if (this.active && this.online && this.view.visible) void this.refresh()
    }
  }

  registerSurface = () => {
    ++this.surfaces
    if (this.active && this.online && this.view.visible) void this.refresh()
    this.update()
    return () => {
      this.surfaces = Math.max(0, this.surfaces - 1)
      if (!this.surfaces) clearTimeout(this.readTimer)
      this.update()
    }
  }

  private applySnapshot(snapshot: LocationSnapshot) {
    const serverTime = Date.parse(snapshot.server_time)
    if (Number.isFinite(serverTime)) this.serverOffset = serverTime - this.clock()
    this.ownRevision = snapshot.own_revision
    const own = snapshot.states.find((state) => state.user_id === this.deps.userId)
    if (this.preferences.revision !== null && (!snapshot.available || !own?.sharing_enabled
      || snapshot.own_revision !== this.preferences.revision)) {
      this.preferences.revision = null
      this.savePreferences()
      clearTimeout(this.collectionTimer)
      ++this.environmentGeneration
      this.update({ error: 'Sharing stopped or changed on another device. Enable it here to share again.' })
    }
    const states = snapshot.states.map((state) => this.preferences.pendingStop && state.user_id === this.deps.userId
      ? { ...state, sharing_enabled: false, latitude: null, longitude: null, accuracy: null, observed_at: null, expires_at: null } : state)
    this.update({ available: snapshot.available, loading: false, states, sharing: this.preferences.revision !== null,
      error: this.view.error === READ_ERROR ? '' : this.view.error })
  }

  private refresh = (): Promise<LocationSnapshot | undefined> => {
    if (!this.active || !this.online || !this.view.visible) return Promise.resolve(undefined)
    if (this.readPromise) return this.readPromise
    const generation = this.generation
    const environment = this.environmentGeneration
    clearTimeout(this.readTimer)
    const promise = this.deps.api.read().then((snapshot) => {
      if (this.active && generation === this.generation && environment === this.environmentGeneration) this.applySnapshot(snapshot)
      return snapshot
    }).catch(() => {
      if (this.active && generation === this.generation && environment === this.environmentGeneration) {
        this.update({ loading: false, error: READ_ERROR })
      }
      return undefined
    }).finally(() => {
      if (this.readPromise !== promise) return
      this.readPromise = undefined
      if (this.active && this.online && this.view.visible && this.surfaces) {
        this.readTimer = setTimeout(() => { void this.refresh() }, MINUTE)
      }
    })
    this.readPromise = promise
    return promise
  }

  startSharing = async () => {
    if (!this.online) { this.update({ error: 'Connect to the internet to enable location sharing.' }); return }
    if (!this.active || this.actionBusy || this.preferences.pendingStop || !this.online || !this.view.visible) return
    if (!this.deps.geolocation) { this.update({ error: 'Location sharing is not supported in this browser.' }); return }
    this.actionBusy = true
    const generation = ++this.generation
    this.readPromise = undefined
    this.update({ error: '' })
    try {
      const snapshot = await this.refresh()
      if (!this.active || generation !== this.generation || !this.online || !this.view.visible) return
      if (!snapshot?.available || snapshot.own_revision === null) {
        this.update({ error: 'Location sharing is not available for this account.' }); return
      }
      const { revision } = await this.deps.api.enable(snapshot.own_revision)
      if (!this.active || generation !== this.generation) return
      this.preferences.revision = revision
      this.ownRevision = revision
      this.savePreferences()
      this.nextAttemptAt = this.preferences.lastAttemptAt ? this.preferences.lastAttemptAt + MINUTE : 0
      this.update({ sharing: true, states: this.view.states.map((state) => state.user_id === this.deps.userId ? { ...state, sharing_enabled: true } : state) })
    } catch { if (this.active && generation === this.generation) this.update({ error: 'Could not enable sharing. Please try again.' }) }
    finally {
      if (generation === this.generation) {
        this.actionBusy = false
        this.update()
        this.scheduleCollection()
      }
    }
  }

  stopSharing = async () => {
    if (!this.active) return
    ++this.generation
    ++this.environmentGeneration
    this.readPromise = undefined
    this.actionBusy = false
    this.preferences.revision = null
    this.preferences.pendingStop = true
    this.savePreferences()
    clearTimeout(this.collectionTimer)
    this.previousFix = null
    this.uploadedFix = null
    this.update({ sharing: false, error: '', states: this.view.states.map((state) => state.user_id === this.deps.userId
      ? { ...state, sharing_enabled: false, latitude: null, longitude: null, accuracy: null, observed_at: null, expires_at: null } : state) })
    await this.flushStop()
  }

  private async flushStop() {
    if (this.stopping || !this.preferences.pendingStop || !this.active || !this.online || !this.view.visible) return
    this.stopping = true
    const generation = this.generation
    try {
      const { revision } = await this.deps.api.stop()
      if (!this.active || generation !== this.generation) return
      this.ownRevision = revision
      this.preferences.pendingStop = false
      this.savePreferences()
      this.update({ error: '' })
    } catch {
      if (this.active && generation === this.generation) this.update({ error: 'Sharing stopped on this phone. Removing the saved location is pending a connection.' })
    } finally {
      this.stopping = false
      if (this.active && this.preferences.pendingStop && this.online && this.view.visible) {
        clearTimeout(this.stopTimer)
        this.stopTimer = setTimeout(() => { void this.flushStop() }, MINUTE)
      }
    }
  }

  updateLocation = () => {
    if (!this.online) { this.update({ error: OFFLINE_MESSAGE }); return }
    if (!this.canCollect() || this.acquiring || this.writing) return
    const earliest = Math.max(this.preferences.lastAttemptAt + MINUTE, this.nextUploadAt)
    if (this.clock() < earliest) { this.update({ error: 'Please wait a minute between location updates.' }); return }
    this.nextAttemptAt = this.clock()
    void this.collect(true)
  }

  private canCollect() {
    return this.active && this.online && this.view.visible && this.view.available
      && !this.preferences.pendingStop && this.preferences.revision !== null && this.preferences.revision === this.ownRevision
  }

  private scheduleCollection() {
    clearTimeout(this.collectionTimer)
    if (!this.canCollect() || this.acquiring || this.writing || this.actionBusy) return
    this.collectionTimer = setTimeout(() => { void this.collect(false) }, Math.max(0, this.nextAttemptAt - this.clock()))
  }

  private async collect(manual: boolean) {
    if (!this.canCollect() || this.acquiring || this.writing || !this.deps.geolocation) return
    const generation = this.generation
    const environment = this.environmentGeneration
    const revision = this.preferences.revision!
    const valid = () => this.canCollect() && generation === this.generation && environment === this.environmentGeneration
    this.acquiring = true
    this.preferences.lastAttemptAt = this.clock()
    this.nextAttemptAt = this.clock() + 2 * MINUTE
    this.savePreferences()
    this.update({ error: '' })
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        this.deps.geolocation!.getCurrentPosition(resolve, reject, LOCATION_OPTIONS)
      })
      if (!valid()) return
      const { latitude, longitude, accuracy } = position.coords
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180
        || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000 || !Number.isFinite(position.timestamp)
        || position.timestamp < this.clock() - MINUTE || position.timestamp > this.clock() + 30_000) {
        throw new LocationApiError('invalid-fix')
      }
      const fix: LocationFix = { latitude, longitude, accuracy, observed_at: new Date(position.timestamp).toISOString() }
      this.stationaryReadings = this.previousFix && !hasMoved(this.previousFix, fix) ? this.stationaryReadings + 1 : 0
      this.previousFix = fix
      this.nextAttemptAt = this.clock() + (this.stationaryReadings >= 2 ? 5 : 2) * MINUTE
      this.failures = 0
      const fresh = !this.uploadedFix || position.timestamp > Date.parse(this.uploadedFix.observed_at)
      const due = manual || !this.uploadedFix || hasMoved(this.uploadedFix, fix)
        || position.timestamp - Date.parse(this.uploadedFix.observed_at) >= 10 * MINUTE
      if (!fresh || !due || this.clock() < this.nextUploadAt) return
      this.writing = true
      this.update()
      const result = await this.deps.api.publish(revision, fix)
      if (!valid()) return
      this.nextUploadAt = Math.max(this.clock() + MINUTE, Date.parse(result.next_allowed_at) - this.serverOffset)
      if (result.status === 'accepted') {
        this.uploadedFix = fix
        const state: LocationState = {
          user_id: this.deps.userId, sharing_enabled: true, ...fix,
          expires_at: new Date(position.timestamp + 24 * 60 * MINUTE).toISOString(),
        }
        this.update({ states: [...this.view.states.filter((item) => item.user_id !== this.deps.userId), state] })
      }
    } catch (error) {
      if (!valid()) return
      const code = error instanceof LocationApiError ? error.code : (error as { code?: number })?.code
      if (code === 1) {
        await this.stopSharing()
        if (this.active) this.update({ error: 'Location permission is denied. Allow location in your browser settings, then enable sharing again.' })
      } else if (code === '40001' || code === '42501') {
        this.preferences.revision = null
        this.savePreferences()
        this.update({ sharing: false, error: 'Sharing stopped or changed on another device. Enable it here to share again.' })
        void this.refresh()
      } else {
        ++this.failures
        this.nextAttemptAt = this.clock() + Math.min(15, 2 ** this.failures) * MINUTE
        this.update({ error: code === 3 ? 'Location took too long. We’ll try again later.' : 'Could not share a location. We’ll try again later.' })
      }
    } finally {
      this.acquiring = false
      this.writing = false
      if (this.active) { this.update(); this.scheduleCollection() }
    }
  }
}
