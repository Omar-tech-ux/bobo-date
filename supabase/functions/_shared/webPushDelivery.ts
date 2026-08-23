export type PushSubscriptionRecord = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
}

export type DeliveryOutcome = 'accepted' | 'expired' | 'failed'

export type DeliveryAttempt = {
  subscriptionId: string
  outcome: DeliveryOutcome
  statusCode?: number
  error?: string
}

export type DeliverySummary = {
  attempted: number
  accepted: number
  expired: number
  failed: number
}

type SendNotification = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { TTL: number; urgency: 'high'; topic: string },
) => Promise<unknown>

type DeliverWebPushInput = {
  subscriptions: PushSubscriptionRecord[]
  payload: string
  ttlSeconds: number
  topic: string
  sendNotification: SendNotification
  deleteExpiredSubscription: (subscriptionId: string) => Promise<void>
  logLabel: string
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 240) : 'Unknown web-push error'
}

function deviceClass(userAgent: string | null) {
  const value = userAgent?.toLowerCase() ?? ''
  if (value.includes('iphone')) return 'iphone'
  if (value.includes('ipad')) return 'ipad'
  if (value.includes('macintosh')) return 'mac'
  return 'other'
}

async function endpointHash(endpoint: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return Array.from(new Uint8Array(digest).slice(0, 6))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export function summarizeDeliveryAttempts(attempts: DeliveryAttempt[]): DeliverySummary {
  return {
    attempted: attempts.length,
    accepted: attempts.filter(({ outcome }) => outcome === 'accepted').length,
    expired: attempts.filter(({ outcome }) => outcome === 'expired').length,
    failed: attempts.filter(({ outcome }) => outcome === 'failed').length,
  }
}

export async function deliverWebPush({
  subscriptions,
  payload,
  ttlSeconds,
  topic,
  sendNotification,
  deleteExpiredSubscription,
  logLabel,
}: DeliverWebPushInput) {
  const attempts = await Promise.all(subscriptions.map(async (subscription): Promise<DeliveryAttempt> => {
    const hash = await endpointHash(subscription.endpoint)
    const device = deviceClass(subscription.user_agent)
    try {
      await sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload, { TTL: ttlSeconds, urgency: 'high', topic })
      console.log(`${logLabel} gateway accepted endpoint=${hash} device=${device}`)
      return { subscriptionId: subscription.id, outcome: 'accepted' }
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        try {
          await deleteExpiredSubscription(subscription.id)
        } catch {
          console.error(`${logLabel} expired cleanup failed endpoint=${hash} device=${device}`)
        }
        return { subscriptionId: subscription.id, outcome: 'expired', statusCode }
      }
      const message = safeErrorMessage(error)
      console.error(`${logLabel} gateway failed endpoint=${hash} device=${device} status=${statusCode ?? 'unknown'} message=${message}`)
      return { subscriptionId: subscription.id, outcome: 'failed', statusCode, error: message }
    }
  }))

  return { attempts, summary: summarizeDeliveryAttempts(attempts) }
}
