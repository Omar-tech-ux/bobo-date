import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverWebPush } from '../../supabase/functions/_shared/webPushDelivery'

const subscriptions = [
  { id: 'accepted', endpoint: 'https://push.example/accepted', p256dh: 'p1', auth: 'a1', user_agent: 'iPhone' },
  { id: 'expired', endpoint: 'https://push.example/expired', p256dh: 'p2', auth: 'a2', user_agent: 'iPad' },
  { id: 'failed', endpoint: 'https://push.example/failed', p256dh: 'p3', auth: 'a3', user_agent: null },
]

afterEach(() => vi.restoreAllMocks())

describe('shared Web Push delivery', () => {
  it('aggregates outcomes and removes only expired subscriptions', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const sendNotification = vi.fn(async ({ endpoint }: { endpoint: string }) => {
      if (endpoint.endsWith('/expired')) throw Object.assign(new Error('gone'), { statusCode: 410 })
      if (endpoint.endsWith('/failed')) throw Object.assign(new Error('gateway unavailable'), { statusCode: 503 })
    })
    const deleteExpiredSubscription = vi.fn(async () => {})

    const result = await deliverWebPush({
      subscriptions,
      payload: '{"notification":true}',
      ttlSeconds: 50_400,
      topic: 'anniv-20260914-morning',
      sendNotification,
      deleteExpiredSubscription,
      logLabel: 'Test push',
    })

    expect(result.summary).toEqual({ attempted: 3, accepted: 1, expired: 1, failed: 1 })
    expect(result.attempts).toEqual([
      { subscriptionId: 'accepted', outcome: 'accepted' },
      { subscriptionId: 'expired', outcome: 'expired', statusCode: 410 },
      { subscriptionId: 'failed', outcome: 'failed', statusCode: 503, error: 'gateway unavailable' },
    ])
    expect(deleteExpiredSubscription).toHaveBeenCalledExactlyOnceWith('expired')
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example/accepted' }),
      '{"notification":true}',
      { TTL: 50_400, urgency: 'high', topic: 'anniv-20260914-morning' },
    )
  })
})
