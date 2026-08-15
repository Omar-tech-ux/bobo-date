import { supabase } from './supabase'

function decodeVapidKey(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/')
  const decoded = window.atob(base64)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

export function canUseNotifications() {
  return 'Notification' in window && 'serviceWorker' in navigator
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
    return { backgroundPushReady: false }
  }

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(publicKey),
    }))

  const serialized = subscription.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: serialized.keys?.p256dh,
      auth: serialized.keys?.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: 'endpoint' },
  )

  if (error) throw error
  return { backgroundPushReady: true }
}

export async function showLiveInvitationNotification(title: string, body: string, inviteId: string) {
  if (!canUseNotifications() || Notification.permission !== 'granted') return

  const registration = await navigator.serviceWorker.ready
  await registration.showNotification(title, {
    body,
    icon: './icons/bobo-heart.svg',
    badge: './icons/bobo-heart.svg',
    tag: `bobo-invite-${inviteId}`,
    data: { route: `#/invite/${inviteId}` },
  })
}
