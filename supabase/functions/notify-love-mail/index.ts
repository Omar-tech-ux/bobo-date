import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

type PushRequest =
  | { event: 'test' }
  | { event: 'invited' | 'responded'; invitationId: string }

type DeliveryOutcome = 'delivered' | 'expired' | 'failed'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) throw new Error('Missing authorization')

    const url = Deno.env.get('SUPABASE_URL')!
    const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@example.com'

    const callerClient = createClient(url, publishableKey, {
      global: { headers: { Authorization: authorization } },
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData.user) throw new Error('Invalid session')

    const payloadRequest = await request.json() as PushRequest
    if (!['test', 'invited', 'responded'].includes(payloadRequest.event)) {
      throw new Error('Unknown notification event')
    }

    const admin = createClient(url, serviceRoleKey)
    const callerId = userData.user.id
    let targetUser = callerId
    let title = 'A test love letter arrived ♡'
    let body = 'Your background notifications are working. The tiny mail carrier made it!'
    let tag = `bobo-test-${Date.now()}`
    let route = '#/inbox'

    if (payloadRequest.event !== 'test') {
      const { data: invitation, error: invitationError } = await admin
        .from('date_invitations')
        .select('*')
        .eq('id', payloadRequest.invitationId)
        .single()
      if (invitationError || !invitation) throw new Error('Invitation not found')

      targetUser = payloadRequest.event === 'invited' ? invitation.recipient_id : invitation.sender_id
      const allowedCaller = payloadRequest.event === 'invited' ? invitation.sender_id : invitation.recipient_id
      if (callerId !== allowedCaller) throw new Error('Not allowed')

      title = payloadRequest.event === 'invited'
        ? 'A tiny date invitation arrived ♡'
        : 'Your date invitation has an answer ♡'
      body = payloadRequest.event === 'invited'
        ? 'Open your love mailbox to see what your person planned.'
        : `The answer is: ${String(invitation.status).replace('_', ' ')}.`
      tag = `bobo-invite-${invitation.id}`
      route = `#/invite/${invitation.id}`
    }

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error('Love-mail push skipped: VAPID is not configured')
      return Response.json(
        { attempted: 0, delivered: 0, expired: 0, failed: 0, reason: 'vapid-not-configured' },
        { headers: corsHeaders },
      )
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    const { data: subscriptions, error: subscriptionError } = await admin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', targetUser)
    if (subscriptionError) throw subscriptionError

    if (!subscriptions?.length) {
      console.log(`Love-mail push has no registered subscription for event=${payloadRequest.event}`)
      return Response.json(
        { attempted: 0, delivered: 0, expired: 0, failed: 0, reason: 'no-subscription' },
        { headers: corsHeaders },
      )
    }

    const notificationPayload = JSON.stringify({
      title,
      body,
      icon: './icons/bobo-heart.svg',
      tag,
      route,
    })

    const outcomes = await Promise.all(subscriptions.map(async (subscription): Promise<DeliveryOutcome> => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, notificationPayload)
        return 'delivered'
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', subscription.id)
          return 'expired'
        }
        const message = error instanceof Error ? error.message.slice(0, 240) : 'Unknown web-push error'
        console.error(`Love-mail delivery failed status=${statusCode ?? 'unknown'} message=${message}`)
        return 'failed'
      }
    }))

    const result = {
      attempted: outcomes.length,
      delivered: outcomes.filter((outcome) => outcome === 'delivered').length,
      expired: outcomes.filter((outcome) => outcome === 'expired').length,
      failed: outcomes.filter((outcome) => outcome === 'failed').length,
    }
    const reason = result.failed > 0
      ? result.delivered > 0 ? 'partial-delivery' : 'delivery-failed'
      : undefined
    console.log(`Love-mail push event=${payloadRequest.event} attempted=${result.attempted} delivered=${result.delivered} expired=${result.expired} failed=${result.failed}`)

    return Response.json({ ...result, ...(reason ? { reason } : {}) }, { headers: corsHeaders })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400, headers: corsHeaders },
    )
  }
})
