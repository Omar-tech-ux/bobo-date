import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { NotificationSetupStatus, PushDeliveryResult, PushFailureCode } from './types'

function decodeVapidKey(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/')
  const decoded = window.atob(base64)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

export function canUseNotifications() {
  return typeof Notification !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof PushManager !== 'undefined'
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

async function storeSubscription(userId: string, subscription: PushSubscription) {
  if (!supabase) throw new Error('The online mailbox is not connected yet.')
  const serialized = subscription.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: serialized.keys?.p256dh,
      auth: serialized.keys?.auth,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  )

  if (error) throw error
}

export async function getNotificationStatus(): Promise<NotificationSetupStatus> {
  if (isIosDevice() && !isStandaloneApp()) {
    return {
      kind: 'installation-required',
      message: 'Add Bobo ♡ to your Home Screen, then open it from the new icon to turn on love letters.',
    }
  }
  if (!canUseNotifications()) {
    return {
      kind: 'unsupported',
      message: 'This browser cannot carry background love letters yet.',
    }
  }
  if (Notification.permission === 'denied') {
    return {
      kind: 'denied',
      message: 'Notifications are blocked. Open iPhone Settings → Notifications → Bobo ♡ and allow them.',
    }
  }
  if (Notification.permission !== 'granted') {
    return {
      kind: 'permission-needed',
      message: 'Let the mailbox tap your shoulder when a new date ticket arrives.',
    }
  }

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return subscription
    ? { kind: 'subscribed', message: 'Love-mail alerts are ready on this device—even when the app is tucked away ♡' }
    : { kind: 'delivery-error', message: 'Permission is on, but this device lost its mailbox address. Reconnect it below.' }
}

export async function syncExistingPushSubscription(userId: string) {
  if (!canUseNotifications() || Notification.permission !== 'granted') return false
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return false
  await storeSubscription(userId, subscription)
  return true
}

export async function enableNotifications(userId: string) {
  if (!supabase || !canUseNotifications()) {
    throw new Error('This browser does not support our tiny mailbox notifications yet.')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notifications are still tucked away. You can allow them from browser settings later.')
  }

  const registration = await navigator.serviceWorker.ready
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim()

  if (!publicKey) {
    throw new Error('Background notifications are not configured for this app yet.')
  }

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(publicKey),
    }))

  await storeSubscription(userId, subscription)
  return { backgroundPushReady: true }
}

const pushFailureCodes = new Set<PushFailureCode>([
  'authentication',
  'invalid-request',
  'configuration',
  'database',
  'no-subscription',
  'gateway-failure',
  'function-error',
])

function isPushFailureCode(value: unknown): value is PushFailureCode {
  return typeof value === 'string' && pushFailureCodes.has(value as PushFailureCode)
}

export function normalizeDeliveryResult(value: unknown): PushDeliveryResult {
  const data = value && typeof value === 'object' ? value as Partial<PushDeliveryResult> : {}
  return {
    attempted: Number(data.attempted) || 0,
    accepted: Number(data.accepted) || 0,
    expired: Number(data.expired) || 0,
    failed: Number(data.failed) || 0,
    reason: isPushFailureCode(data.reason) ? data.reason : undefined,
  }
}

export async function getPushFailureCode(error: unknown): Promise<PushFailureCode> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json() as { code?: unknown }
      if (isPushFailureCode(body.code)) return body.code
    } catch {
      // The function returned a non-JSON error page. Use the generic fallback below.
    }
  }
  return 'function-error'
}

export async function requestPushDelivery(
  request: { event: 'test'; endpoint: string } | { event: 'invited' | 'responded'; invitationId: string },
): Promise<PushDeliveryResult> {
  if (!supabase) {
    return { attempted: 0, accepted: 0, expired: 0, failed: 1, reason: 'function-error' }
  }

  const { data, error } = await supabase.functions.invoke('notify-love-mail', { body: request })
  if (error) {
    const reason = await getPushFailureCode(error)
    console.error(`Love-mail push function failed code=${reason}:`, error.message)
    return { attempted: 0, accepted: 0, expired: 0, failed: 1, reason }
  }
  return normalizeDeliveryResult(data)
}

export function createTestPushRequest(subscription: Pick<PushSubscription, 'endpoint'>) {
  return { event: 'test' as const, endpoint: subscription.endpoint }
}

export async function sendTestNotification(): Promise<PushDeliveryResult> {
  if (!canUseNotifications() || Notification.permission !== 'granted') {
    return { attempted: 0, accepted: 0, expired: 0, failed: 0, reason: 'no-subscription' }
  }
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    return { attempted: 0, accepted: 0, expired: 0, failed: 0, reason: 'no-subscription' }
  }
  return requestPushDelivery(createTestPushRequest(subscription))
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export async function setPendingInvitationBadge(count: number) {
  const badgeNavigator = navigator as BadgeNavigator
  if (count > 0) await badgeNavigator.setAppBadge?.(count)
  else await badgeNavigator.clearAppBadge?.()
}

export async function clearPendingInvitationBadge() {
  await (navigator as BadgeNavigator).clearAppBadge?.()
}

export async function showLiveInvitationNotification(title: string, body: string, inviteId: string) {
  if (!canUseNotifications() || Notification.permission !== 'granted') return

  const registration = await navigator.serviceWorker.ready
  await registration.showNotification(title, {
    body,
    icon: './icons/bobo-heart-512.png',
    badge: './icons/bobo-heart-512.png',
    tag: `bobo-invite-${inviteId}`,
    data: { route: `#/invite/${inviteId}` },
  })
}
