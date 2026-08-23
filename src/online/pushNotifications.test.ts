import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import {
  createTestPushRequest,
  getNotificationStatus,
  getPushFailureCode,
  normalizeDeliveryResult,
} from './pushNotifications'

function installNotificationMocks(permission: NotificationPermission, subscription: object | null = null) {
  vi.stubGlobal('Notification', { permission })
  vi.stubGlobal('PushManager', class PushManager {})
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) },
      }),
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined })
})

describe('notification capability status', () => {
  it('reports unsupported browsers without Notification and Push APIs', async () => {
    vi.stubGlobal('Notification', undefined)
    vi.stubGlobal('PushManager', undefined)
    expect((await getNotificationStatus()).kind).toBe('unsupported')
  })

  it('keeps permission requests behind an explicit action', async () => {
    installNotificationMocks('default')
    expect(await getNotificationStatus()).toMatchObject({ kind: 'permission-needed' })
  })

  it('distinguishes a healthy subscription from a missing device address', async () => {
    installNotificationMocks('granted', { endpoint: 'https://push.example/device' })
    expect((await getNotificationStatus()).kind).toBe('subscribed')

    installNotificationMocks('granted', null)
    expect((await getNotificationStatus()).kind).toBe('delivery-error')
  })

  it('explains when notification permission was denied', async () => {
    installNotificationMocks('denied')
    expect(await getNotificationStatus()).toMatchObject({ kind: 'denied' })
  })
})

describe('push delivery contract', () => {
  it('targets a test notification to the current device endpoint', () => {
    expect(createTestPushRequest({ endpoint: 'https://web.push.apple.com/current-device' })).toEqual({
      event: 'test',
      endpoint: 'https://web.push.apple.com/current-device',
    })
  })

  it('normalizes gateway acceptance without claiming device delivery', () => {
    expect(normalizeDeliveryResult({ attempted: '3', accepted: 2, expired: 1, failed: 0 })).toEqual({
      attempted: 3,
      accepted: 2,
      expired: 1,
      failed: 0,
      reason: undefined,
    })
  })

  it('parses structured function error codes', async () => {
    const error = new FunctionsHttpError(new Response(
      JSON.stringify({ code: 'authentication', error: 'sanitized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ))
    await expect(getPushFailureCode(error)).resolves.toBe('authentication')
  })

  it('falls back when a function error has an unknown response', async () => {
    const error = new FunctionsHttpError(new Response('bad gateway', { status: 502 }))
    await expect(getPushFailureCode(error)).resolves.toBe('function-error')
  })
})
