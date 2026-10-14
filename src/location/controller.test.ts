import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocationController, LOCATION_OPTIONS } from './controller'
import type { LocationApi, LocationFix, LocationSnapshot, LocationState } from './types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const USER = 'me'
const PARTNER = 'partner'
const COUPLE = 'our-couple'
const PREFS = `bobo-location:v1:${USER}:${COUPLE}`
const controllers: LocationController[] = []

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function blankState(userId: string): LocationState {
  return { user_id: userId, sharing_enabled: false, latitude: null, longitude: null, accuracy: null, observed_at: null, expires_at: null }
}

function position(latitude = 31.95, longitude = 35.91, accuracy = 30, timestamp = Date.now()): GeolocationPosition {
  return {
    coords: { latitude, longitude, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
    timestamp,
    toJSON: () => ({}),
  }
}

function harness(options: { storedRevision?: number; serverRevision?: number; serverSharing?: boolean; pendingStop?: boolean } = {}) {
  let revision = options.serverRevision ?? 0
  const states = [blankState(USER), blankState(PARTNER)]
  states[0].sharing_enabled = options.serverSharing ?? false
  const store = new Map<string, string>()
  if (options.storedRevision !== undefined || options.pendingStop) {
    store.set(PREFS, JSON.stringify({ revision: options.storedRevision ?? null, pendingStop: options.pendingStop ?? false, lastAttemptAt: 0 }))
  }
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value) }),
    removeItem: vi.fn((key: string) => { store.delete(key) }),
  }
  const api = {
    read: vi.fn<LocationApi['read']>(async () => ({
      available: true, server_time: new Date().toISOString(), own_revision: revision, states: states.map((state) => ({ ...state })),
    })),
    enable: vi.fn<LocationApi['enable']>(async () => {
      revision += 1
      states[0].sharing_enabled = true
      return { revision }
    }),
    publish: vi.fn<LocationApi['publish']>(async (_expected: number, fix: LocationFix) => {
      Object.assign(states[0], fix, { expires_at: new Date(Date.parse(fix.observed_at) + 24 * HOUR).toISOString() })
      return { status: 'accepted', next_allowed_at: new Date(Date.now() + MINUTE).toISOString() }
    }),
    stop: vi.fn<LocationApi['stop']>(async () => {
      revision += 1
      Object.assign(states[0], blankState(USER))
      return { revision }
    }),
  }
  const requests: { success: PositionCallback; error: PositionErrorCallback | null | undefined; options: PositionOptions | undefined }[] = []
  const geolocation = {
    getCurrentPosition: vi.fn<Geolocation['getCurrentPosition']>((success, error, requestOptions) => {
      requests.push({ success, error, options: requestOptions })
    }),
  }
  const controller = new LocationController({ userId: USER, coupleId: COUPLE, api, geolocation, storage, now: () => Date.now() })
  controllers.push(controller)
  const flush = () => vi.advanceTimersByTimeAsync(0)
  const start = async () => { controller.start(); await flush() }
  const enable = async () => { await controller.startSharing(); await flush() }
  const fix = async (index = requests.length - 1, value = position()) => { requests[index].success(value); await flush() }
  return { api, controller, geolocation, requests, storage, store, states, start, enable, fix, flush }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'))
})

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.destroy())
  vi.useRealTimers()
})

describe('foreground location collection', () => {
  it('does not request GPS until this device explicitly opts in', async () => {
    const h = harness({ serverSharing: true, serverRevision: 7 })
    await h.start()
    await vi.advanceTimersByTimeAsync(20 * MINUTE)
    expect(h.geolocation.getCurrentPosition).not.toHaveBeenCalled()
    expect(h.controller.getSnapshot().sharing).toBe(false)

    await h.enable()
    expect(h.api.enable).toHaveBeenCalledWith(7)
    expect(h.geolocation.getCurrentPosition).toHaveBeenCalledOnce()
    expect(h.requests[0].options).toEqual({ enableHighAccuracy: false, maximumAge: MINUTE, timeout: 10_000 })
    expect(LOCATION_OPTIONS).toEqual(h.requests[0].options)
    await h.fix()
    expect(h.api.publish).toHaveBeenCalledWith(8, {
      latitude: 31.95, longitude: 35.91, accuracy: 30, observed_at: '2026-10-15T12:20:00.000Z',
    })
  })

  it('samples every two minutes, then every five after two stationary comparisons', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix()
    await vi.advanceTimersByTimeAsync(2 * MINUTE - 1)
    expect(h.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1); await h.fix()
    await vi.advanceTimersByTimeAsync(2 * MINUTE); await h.fix()
    expect(h.requests).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1)
    expect(h.requests).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1); await h.fix()
    expect(h.requests).toHaveLength(4)
    expect(h.api.publish).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(5 * MINUTE); await h.fix()
    expect(h.api.publish).toHaveBeenCalledTimes(2)
  })

  it('returns to two-minute sampling after meaningful movement', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix()
    await vi.advanceTimersByTimeAsync(2 * MINUTE); await h.fix()
    await vi.advanceTimersByTimeAsync(2 * MINUTE); await h.fix()
    await vi.advanceTimersByTimeAsync(5 * MINUTE); await h.fix(undefined, position(31.96))
    expect(h.api.publish).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2 * MINUTE - 1)
    expect(h.requests).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.requests).toHaveLength(5)
  })

  it('does not mistake GPS uncertainty for movement', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix(undefined, position(31.95, 35.91, 800))
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    await h.fix(undefined, position(31.953, 35.91, 800))
    expect(h.api.publish).toHaveBeenCalledOnce()
  })

  it('limits manual refresh to one acquisition per minute and never overlaps requests', async () => {
    const h = harness()
    await h.start(); await h.enable()
    h.controller.updateLocation(); h.controller.updateLocation()
    await vi.advanceTimersByTimeAsync(MINUTE)
    h.controller.updateLocation()
    expect(h.requests).toHaveLength(1)
    await h.fix()
    h.controller.updateLocation()
    await h.flush()
    expect(h.requests).toHaveLength(1)
    expect(h.api.publish).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(MINUTE - 1)
    h.controller.updateLocation()
    expect(h.requests).toHaveLength(1)
    expect(h.api.publish).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    h.controller.updateLocation()
    await h.flush(); await h.fix()
    expect(h.requests).toHaveLength(2)
    expect(h.api.publish).toHaveBeenCalledTimes(2)
    const observations = h.api.publish.mock.calls.map(([, fix]) => Date.parse(fix.observed_at))
    expect(observations[1] - observations[0]).toBeGreaterThanOrEqual(MINUTE)
  })

  it('honors a longer server throttle after another device has published', async () => {
    const h = harness()
    h.api.publish.mockResolvedValueOnce({ status: 'throttled', next_allowed_at: new Date(Date.now() + 3 * MINUTE).toISOString() })
    await h.start(); await h.enable(); await h.fix()
    await vi.advanceTimersByTimeAsync(MINUTE)
    h.controller.updateLocation()
    expect(h.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(MINUTE); await h.fix(undefined, position(32))
    expect(h.api.publish).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(MINUTE)
    h.controller.updateLocation()
    await h.flush(); await h.fix(undefined, position(32))
    expect(h.api.publish).toHaveBeenCalledTimes(2)
  })

  it.each([
    { description: 'out-of-range latitude', fix: () => position(91) },
    { description: 'nonfinite longitude', fix: () => position(31.95, Number.NaN) },
    { description: 'negative accuracy', fix: () => position(31.95, 35.91, -1) },
    { description: 'expired cached observation', fix: () => position(31.95, 35.91, 30, Date.now() - MINUTE - 1) },
    { description: 'future observation', fix: () => position(31.95, 35.91, 30, Date.now() + MINUTE) },
  ])('rejects $description without uploading', async ({ fix }) => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix(undefined, fix())
    expect(h.api.publish).not.toHaveBeenCalled()
  })

  it.each(['hidden', 'offline', 'destroyed'] as const)('discards GPS callbacks after becoming %s', async (reason) => {
    const h = harness()
    await h.start(); await h.enable()
    if (reason === 'hidden') h.controller.setEnvironment(false, true)
    else if (reason === 'offline') h.controller.setEnvironment(true, false)
    else h.controller.destroy()
    await h.fix()
    await vi.advanceTimersByTimeAsync(20 * MINUTE)
    expect(h.api.publish).not.toHaveBeenCalled()
    expect(h.requests).toHaveLength(1)
  })

  it('resumes once without catching up on missed observations', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix()
    h.controller.setEnvironment(false, true)
    await vi.advanceTimersByTimeAsync(HOUR)
    h.controller.setEnvironment(true, true)
    await h.flush()
    expect(h.requests).toHaveLength(2)
    await h.fix()
    expect(h.api.publish).toHaveBeenCalledTimes(2)
    await h.flush()
    expect(h.requests).toHaveLength(2)
  })

  it('stops collection after permission denial instead of retrying GPS', async () => {
    const h = harness()
    await h.start(); await h.enable()
    h.requests[0].error?.({ code: 1, message: 'Denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
    await h.flush()
    expect(h.controller.getSnapshot().sharing).toBe(false)
    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(h.requests).toHaveLength(1)
    expect(h.api.publish).not.toHaveBeenCalled()
  })

  it('backs off transient acquisition failures without a rapid retry loop', async () => {
    const h = harness()
    await h.start(); await h.enable()
    h.requests[0].error?.({ code: 3, message: 'Timed out', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
    await h.flush()
    await vi.advanceTimersByTimeAsync(2 * MINUTE - 1)
    expect(h.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(h.requests.length).toBeLessThanOrEqual(2)
    expect(h.api.publish).not.toHaveBeenCalled()
  })
})

describe('sharing privacy and races', () => {
  it('requires stored device consent to match the current server revision', async () => {
    const h = harness({ storedRevision: 2, serverRevision: 4, serverSharing: true })
    await h.start()
    expect(h.geolocation.getCurrentPosition).not.toHaveBeenCalled()
    expect(h.controller.getSnapshot().sharing).toBe(false)
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(h.geolocation.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('waits for server verification before resuming saved device consent', async () => {
    const h = harness({ storedRevision: 4, serverRevision: 4, serverSharing: true })
    const reading = deferred<LocationSnapshot>()
    h.api.read.mockReturnValueOnce(reading.promise)
    h.controller.start()
    await h.flush()
    expect(h.requests).toHaveLength(0)
    reading.resolve({ available: true, server_time: new Date().toISOString(), own_revision: 4, states: h.states })
    await h.flush()
    expect(h.requests).toHaveLength(1)
  })

  it('clears local coordinates immediately and discards late GPS on Stop', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix()
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    const stopping = deferred<{ revision: number }>()
    h.api.stop.mockReturnValueOnce(stopping.promise)
    const operation = h.controller.stopSharing()
    expect(h.controller.getSnapshot().sharing).toBe(false)
    expect(h.controller.getSnapshot().states.find((state) => state.user_id === USER)?.latitude).toBeNull()
    await h.fix(undefined, position(32))
    expect(h.api.publish).toHaveBeenCalledOnce()
    stopping.resolve({ revision: 2 })
    await operation
    expect(h.controller.getSnapshot().pendingStop).toBe(false)
  })

  it('persists only a pending stop offline and sends it before sharing can resume', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix()
    h.controller.setEnvironment(true, false)
    await h.controller.stopSharing()
    expect(h.api.stop).not.toHaveBeenCalled()
    expect(h.controller.getSnapshot()).toMatchObject({ sharing: false, pendingStop: true })
    expect(JSON.parse(h.store.get(PREFS)!)).toMatchObject({ revision: null, pendingStop: true })
    h.controller.setEnvironment(true, true)
    await h.flush()
    expect(h.api.stop).toHaveBeenCalledOnce()
    expect(h.controller.getSnapshot()).toMatchObject({ sharing: false, pendingStop: false })
    expect(h.requests).toHaveLength(1)
  })

  it('retries a persisted stop before attempting saved opt-in', async () => {
    const h = harness({ storedRevision: 4, serverRevision: 4, serverSharing: true, pendingStop: true })
    await h.start()
    expect(h.api.stop).toHaveBeenCalledOnce()
    expect(h.requests).toHaveLength(0)
    expect(h.controller.getSnapshot()).toMatchObject({ sharing: false, pendingStop: false })
  })

  it('does not let a late enable response revive stopped sharing', async () => {
    const h = harness()
    await h.start()
    const enabling = deferred<{ revision: number }>()
    h.api.enable.mockReturnValueOnce(enabling.promise)
    const enableOperation = h.controller.startSharing()
    await h.flush()
    await h.controller.stopSharing()
    enabling.resolve({ revision: 1 })
    await enableOperation; await h.flush()
    expect(h.controller.getSnapshot().sharing).toBe(false)
    expect(h.requests).toHaveLength(0)
    expect(h.api.stop).toHaveBeenCalled()
  })

  it('does not let an older read restore coordinates after Stop', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix()
    const stale = { available: true, server_time: new Date().toISOString(), own_revision: 1, states: h.states.map((state) => ({ ...state })) }
    const reading = deferred<LocationSnapshot>()
    h.api.read.mockReturnValueOnce(reading.promise)
    const leave = h.controller.registerSurface()
    await h.flush()
    await h.controller.stopSharing()
    reading.resolve(stale)
    await h.flush()
    expect(h.controller.getSnapshot().sharing).toBe(false)
    expect(h.controller.getSnapshot().states.find((state) => state.user_id === USER)?.latitude).toBeNull()
    leave()
  })

  it('does not let an upload response restore coordinates after Stop', async () => {
    const h = harness()
    const publishing = deferred<Awaited<ReturnType<LocationApi['publish']>>>()
    h.api.publish.mockReturnValueOnce(publishing.promise)
    await h.start(); await h.enable(); await h.fix()
    await h.controller.stopSharing()
    publishing.resolve({ status: 'accepted', next_allowed_at: new Date(Date.now() + MINUTE).toISOString() })
    await h.flush()
    expect(h.controller.getSnapshot().sharing).toBe(false)
    expect(h.controller.getSnapshot().states.find((state) => state.user_id === USER)?.latitude).toBeNull()
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(h.requests).toHaveLength(1)
  })

  it('retains a pending stop through a server failure and retries once per minute', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix()
    h.api.stop.mockRejectedValueOnce(new Error('Transport failed'))
    await h.controller.stopSharing()
    expect(h.controller.getSnapshot()).toMatchObject({ sharing: false, pendingStop: true })
    await vi.advanceTimersByTimeAsync(MINUTE - 1)
    expect(h.api.stop).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.api.stop).toHaveBeenCalledTimes(2)
    expect(h.controller.getSnapshot().pendingStop).toBe(false)
    expect(h.requests).toHaveLength(1)
  })

  it('does not redisplay own coordinates from a surface read while removal is pending', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix()
    h.api.stop.mockRejectedValueOnce(new Error('Transport failed'))
    await h.controller.stopSharing()
    const leave = h.controller.registerSurface()
    await h.flush()
    expect(h.controller.getSnapshot()).toMatchObject({ sharing: false, pendingStop: true })
    expect(h.controller.getSnapshot().states.find((state) => state.user_id === USER)).toMatchObject({
      sharing_enabled: false, latitude: null, longitude: null, accuracy: null, observed_at: null, expires_at: null,
    })
    leave()
  })

  it('can enable again after a lifecycle teardown interrupted an earlier enable', async () => {
    const h = harness()
    await h.start()
    const enabling = deferred<{ revision: number }>()
    h.api.enable.mockReturnValueOnce(enabling.promise)
    const staleEnable = h.controller.startSharing()
    await h.flush()
    expect(h.api.enable).toHaveBeenCalledOnce()
    h.controller.destroy()
    h.controller.start()
    await h.flush()
    enabling.resolve({ revision: 1 })
    await staleEnable; await h.flush()
    await h.enable()
    expect(h.api.enable).toHaveBeenCalledTimes(2)
    expect(h.requests).toHaveLength(1)
  })

  it('retries saved-consent verification after a transient initial read failure without a mounted card', async () => {
    const h = harness({ storedRevision: 4, serverRevision: 4, serverSharing: true })
    h.api.read.mockRejectedValueOnce(new Error('Temporary disconnection'))
    await h.start()
    expect(h.requests).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    expect(h.api.read.mock.calls.length).toBeGreaterThanOrEqual(2)
    // The successful retry schedules GPS on the next event-loop turn.
    await vi.advanceTimersByTimeAsync(1)
    expect(h.requests).toHaveLength(1)
  })

  it('applies cross-tab pending Stop immediately and discards an in-flight GPS callback', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix()
    await vi.advanceTimersByTimeAsync(2 * MINUTE)
    h.store.set(PREFS, JSON.stringify({ revision: null, pendingStop: true, lastAttemptAt: Date.now() }))
    h.controller.syncPreferences()
    expect(h.controller.getSnapshot().sharing).toBe(false)
    expect(h.controller.getSnapshot().states.find((state) => state.user_id === USER)?.latitude).toBeNull()
    await h.fix(undefined, position(32))
    expect(h.api.stop).toHaveBeenCalledOnce()
    expect(h.api.publish).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(h.requests).toHaveLength(2)
  })

  it('does not adopt cross-tab opt-in as consent for this tab', async () => {
    const h = harness()
    await h.start()
    h.store.set(PREFS, JSON.stringify({ revision: 1, pendingStop: false, lastAttemptAt: 0 }))
    h.controller.syncPreferences()
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(h.controller.getSnapshot().sharing).toBe(false)
    expect(h.requests).toHaveLength(0)
    expect(h.api.enable).not.toHaveBeenCalled()
  })

  it('retries pending Stop independently of mounted surface polling', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix()
    const leave = h.controller.registerSurface()
    await h.flush()
    const initialReads = h.api.read.mock.calls.length
    h.api.stop.mockRejectedValueOnce(new Error('First failure')).mockRejectedValueOnce(new Error('Second failure'))
    await h.controller.stopSharing()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(h.api.stop).toHaveBeenCalledTimes(2)
    expect(h.api.read).toHaveBeenCalledTimes(initialReads + 1)
    expect(h.controller.getSnapshot()).toMatchObject({ sharing: false, pendingStop: true })
    expect(h.controller.getSnapshot().states.find((state) => state.user_id === USER)?.latitude).toBeNull()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(h.api.stop).toHaveBeenCalledTimes(3)
    expect(h.api.read).toHaveBeenCalledTimes(initialReads + 2)
    expect(h.controller.getSnapshot()).toMatchObject({ sharing: false, pendingStop: false })
    expect(h.requests).toHaveLength(1)
    leave()
  })

  it('discards pending GPS when a surface detects a remotely revoked revision', async () => {
    const h = harness({ storedRevision: 4, serverRevision: 4, serverSharing: true })
    await h.start()
    h.api.read.mockResolvedValueOnce({ available: true, server_time: new Date().toISOString(), own_revision: 5, states: h.states })
    const leave = h.controller.registerSurface()
    await h.flush(); await h.fix()
    expect(h.controller.getSnapshot().sharing).toBe(false)
    expect(h.api.publish).not.toHaveBeenCalled()
    expect(JSON.parse(h.store.get(PREFS)!)).toHaveProperty('revision', null)
    leave()
  })

  it('never persists coordinates, accuracy, or observation timestamps', async () => {
    const h = harness()
    await h.start(); await h.enable(); await h.fix()
    expect(h.storage.setItem).toHaveBeenCalled()
    for (const [, serialized] of h.storage.setItem.mock.calls) {
      expect(Object.keys(JSON.parse(serialized)).sort()).toEqual(['lastAttemptAt', 'pendingStop', 'revision'])
      expect(serialized).not.toMatch(/latitude|longitude|accuracy|observed_at|31\.95|35\.91/)
    }
  })
})

describe('partner reads and expiry', () => {
  it('polls once per minute only while a registered surface is visible', async () => {
    const h = harness()
    await h.start()
    const baseline = h.api.read.mock.calls.length
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(h.api.read).toHaveBeenCalledTimes(baseline)
    const leave = h.controller.registerSurface()
    await h.flush()
    expect(h.api.read).toHaveBeenCalledTimes(baseline + 1)
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(h.api.read).toHaveBeenCalledTimes(baseline + 2)
    h.controller.setEnvironment(false, true)
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(h.api.read).toHaveBeenCalledTimes(baseline + 2)
    h.controller.setEnvironment(true, true)
    await h.flush()
    const visibleReads = h.api.read.mock.calls.length
    leave()
    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(h.api.read).toHaveBeenCalledTimes(visibleReads)
    expect(h.requests).toHaveLength(0)
  })

  it('shares polling between multiple mounted location surfaces', async () => {
    const h = harness()
    await h.start()
    const leaveOne = h.controller.registerSurface()
    const leaveTwo = h.controller.registerSurface()
    await h.flush()
    const baseline = h.api.read.mock.calls.length
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(h.api.read).toHaveBeenCalledTimes(baseline + 1)
    leaveOne()
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(h.api.read).toHaveBeenCalledTimes(baseline + 2)
    leaveTwo()
  })

  it('removes a last-known position at the exact expiry boundary even offline', async () => {
    const h = harness()
    const expiry = Date.now() + MINUTE
    Object.assign(h.states[1], {
      sharing_enabled: true, latitude: 31.9, longitude: 35.9, accuracy: 50,
      observed_at: new Date(expiry - 24 * HOUR).toISOString(), expires_at: new Date(expiry).toISOString(),
    })
    await h.start()
    h.controller.setEnvironment(true, false)
    expect(h.controller.getSnapshot().states.find((state) => state.user_id === PARTNER)?.latitude).toBe(31.9)
    await vi.advanceTimersByTimeAsync(MINUTE - 1)
    expect(h.controller.getSnapshot().states.find((state) => state.user_id === PARTNER)?.latitude).toBe(31.9)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.controller.getSnapshot().states.find((state) => state.user_id === PARTNER)?.latitude).toBeNull()
  })
})
