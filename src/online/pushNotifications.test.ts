import { afterEach, describe, expect, it, vi } from 'vitest'
import { getNotificationStatus } from './pushNotifications'

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
