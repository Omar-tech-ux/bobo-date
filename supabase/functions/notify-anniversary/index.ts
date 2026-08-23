import { createClient } from 'npm:@supabase/supabase-js@2'
// @ts-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7'
import {
  anniversaryAutomationSecretsMatch,
  getAnniversaryOccurrence,
  groupSubscriptionsByCouple,
  type AnniversaryCoupleMember,
  type AnniversaryOccurrence,
} from '../_shared/anniversaryReminder.ts'
import { buildDeclarativePushPayload } from '../_shared/pushPayload.ts'
import { deliverWebPush, type DeliverySummary, type PushSubscriptionRecord } from '../_shared/webPushDelivery.ts'

const responseHeaders = { 'Content-Type': 'application/json' }

type ReminderSetting = {
  couple_id: string
  time_zone: string
}

type DueSetting = ReminderSetting & { occurrence: AnniversaryOccurrence }
type AnniversarySubscription = PushSubscriptionRecord & { user_id: string }

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: responseHeaders })
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 240)
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message.slice(0, 240)
  }
  return 'Unknown error'
}

function emptySummary(): DeliverySummary {
  return { attempted: 0, accepted: 0, expired: 0, failed: 0 }
}

function addSummary(total: DeliverySummary, addition: DeliverySummary) {
  total.attempted += addition.attempted
  total.accepted += addition.accepted
  total.expired += addition.expired
  total.failed += addition.failed
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const automationSecret = Deno.env.get('ANNIVERSARY_AUTOMATION_SECRET')?.trim()
    if (!automationSecret) {
      console.error('Anniversary reminder configuration is missing ANNIVERSARY_AUTOMATION_SECRET')
      return json({ error: 'Anniversary reminders are not configured.' }, 500)
    }
    if (!await anniversaryAutomationSecretsMatch(request.headers.get('x-anniversary-secret'), automationSecret)) {
      return json({ error: 'Unauthorized.' }, 401)
    }

    const url = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    const vapidSubject = Deno.env.get('VAPID_SUBJECT')
    const pwaBaseUrl = Deno.env.get('PWA_BASE_URL')
    if (!url || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject || !pwaBaseUrl) {
      throw new Error('One or more required function secrets are missing')
    }
    const parsedBaseUrl = new URL(pwaBaseUrl)
    if (parsedBaseUrl.protocol !== 'https:') throw new Error('PWA_BASE_URL must use HTTPS')

    const admin = createClient(url, serviceRoleKey)
    const { data: settings, error: settingsError } = await admin
      .from('anniversary_reminder_settings')
      .select('couple_id, time_zone, couples!inner(sealed)')
      .eq('enabled', true)
      .eq('couples.sealed', true)
    if (settingsError) throw settingsError

    const now = new Date()
    const dueSettings: DueSetting[] = []
    for (const setting of (settings ?? []) as unknown as ReminderSetting[]) {
      try {
        const occurrence = getAnniversaryOccurrence(now, setting.time_zone)
        if (occurrence) dueSettings.push({ ...setting, occurrence })
      } catch (error) {
        console.error(`Anniversary reminder skipped invalid timezone couple=${setting.couple_id} message=${safeErrorMessage(error)}`)
      }
    }
    if (dueSettings.length === 0) return json({ due: 0, claimed: 0, ...emptySummary() })

    const coupleIds = dueSettings.map(({ couple_id }) => couple_id)
    const { data: memberRows, error: membersError } = await admin
      .from('couple_members')
      .select('couple_id, user_id')
      .in('couple_id', coupleIds)
    if (membersError) throw membersError
    const members = (memberRows ?? []) as AnniversaryCoupleMember[]
    const userIds = members.map(({ user_id }) => user_id)
    if (userIds.length === 0) return json({ due: dueSettings.length, claimed: 0, ...emptySummary() })

    const { data: subscriptionRows, error: subscriptionsError } = await admin
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth, user_agent')
      .in('user_id', userIds)
    if (subscriptionsError) throw subscriptionsError

    const subscriptionsByCouple = groupSubscriptionsByCouple(
      members,
      (subscriptionRows ?? []) as AnniversarySubscription[],
    )

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    const total = emptySummary()
    let claimedCount = 0

    for (const setting of dueSettings) {
      const candidates = subscriptionsByCouple.get(setting.couple_id) ?? []
      const claimed = (await Promise.all(candidates.map(async (subscription) => {
        const { data, error } = await admin.rpc('claim_anniversary_delivery', {
          p_couple_id: setting.couple_id,
          p_subscription_id: subscription.id,
          p_reminder_date: setting.occurrence.localDate,
          p_slot: setting.occurrence.slot,
        })
        if (error) throw error
        return data === true ? subscription : null
      }))).filter((subscription): subscription is AnniversarySubscription => subscription !== null)

      if (claimed.length === 0) continue
      claimedCount += claimed.length
      const payload = JSON.stringify(buildDeclarativePushPayload({
        title: setting.occurrence.title,
        body: setting.occurrence.body,
        tag: setting.occurrence.tag,
        route: setting.occurrence.route,
        baseUrl: parsedBaseUrl.href,
      }))
      const { attempts, summary } = await deliverWebPush({
        subscriptions: claimed,
        payload,
        ttlSeconds: setting.occurrence.ttlSeconds,
        topic: setting.occurrence.topic,
        sendNotification: (subscription, notificationPayload, options) => webpush.sendNotification(
          subscription,
          notificationPayload,
          options,
        ),
        deleteExpiredSubscription: async (subscriptionId) => {
          const { error } = await admin.from('push_subscriptions').delete().eq('id', subscriptionId)
          if (error) throw error
        },
        logLabel: 'Anniversary reminder',
      })
      addSummary(total, summary)

      await Promise.all(attempts.map(async (attempt) => {
        if (attempt.outcome === 'expired') return
        const update = attempt.outcome === 'accepted'
          ? { status: 'accepted', accepted_at: new Date().toISOString(), lease_expires_at: null, last_error: null, updated_at: new Date().toISOString() }
          : { status: 'failed', accepted_at: null, lease_expires_at: null, last_error: attempt.error ?? 'Push gateway failure', updated_at: new Date().toISOString() }
        const { error } = await admin
          .from('anniversary_notification_deliveries')
          .update(update)
          .eq('subscription_id', attempt.subscriptionId)
          .eq('reminder_date', setting.occurrence.localDate)
          .eq('slot', setting.occurrence.slot)
        if (error) throw error
      }))
    }

    console.log(`Anniversary reminder due=${dueSettings.length} claimed=${claimedCount} attempted=${total.attempted} accepted=${total.accepted} expired=${total.expired} failed=${total.failed}`)
    return json({ due: dueSettings.length, claimed: claimedCount, ...total })
  } catch (error) {
    const message = safeErrorMessage(error)
    console.error(`Anniversary reminder failed message=${message}`)
    return json({ error: 'Anniversary reminders could not be delivered.' }, 500)
  }
})
