import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { buildDeclarativePushPayload } from '../_shared/pushPayload.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

type PushRequest =
  | { event: 'test'; endpoint: string }
  | { event: 'invited' | 'responded'; invitationId: string }

type DeliveryOutcome = 'accepted' | 'expired' | 'failed'
type FailureCode =
  | 'authentication'
  | 'invalid-request'
  | 'configuration'
  | 'database'

type FailureStage =
  | 'configuration'
  | 'authentication'
  | 'request'
  | 'invitation'
  | 'subscriptions'
  | 'delivery'

const failureDetails: Record<FailureCode, { status: number; message: string }> = {
  authentication: { status: 401, message: 'Your session could not be verified.' },
  'invalid-request': { status: 400, message: 'The notification request was invalid.' },
  configuration: { status: 500, message: 'Background notifications are not configured correctly.' },
  database: { status: 500, message: 'Notification devices could not be loaded.' },
}

function failureResponse(code: FailureCode) {
  const failure = failureDetails[code]
  return Response.json(
    { code, error: failure.message },
    { status: failure.status, headers: corsHeaders },
  )
}

function failureForStage(stage: FailureStage): FailureCode {
  if (stage === 'authentication') return 'authentication'
  if (stage === 'request' || stage === 'invitation') return 'invalid-request'
  if (stage === 'configuration') return 'configuration'
  return 'database'
}

function getBearerToken(value: string | null) {
  const match = value?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function isPushRequest(value: unknown): value is PushRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  if (request.event === 'test') {
    return typeof request.endpoint === 'string' && request.endpoint.startsWith('https://')
  }
  return (request.event === 'invited' || request.event === 'responded')
    && typeof request.invitationId === 'string'
    && request.invitationId.length > 0
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let stage: FailureStage = 'configuration'
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!
    const vapidSubject = Deno.env.get('VAPID_SUBJECT')!
    const pwaBaseUrl = Deno.env.get('PWA_BASE_URL')!

    if (!url || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject || !pwaBaseUrl) {
      throw new Error('One or more required function secrets are missing')
    }
    const parsedBaseUrl = new URL(pwaBaseUrl)
    if (parsedBaseUrl.protocol !== 'https:') throw new Error('PWA_BASE_URL must use HTTPS')

    const admin = createClient(url, serviceRoleKey)
    stage = 'authentication'
    const accessToken = getBearerToken(request.headers.get('Authorization'))
    if (!accessToken) return failureResponse('authentication')
    const { data: userData, error: userError } = await admin.auth.getUser(accessToken)
    if (userError || !userData.user) {
      console.error(`Love-mail request rejected stage=authentication message=${userError?.message ?? 'missing user'}`)
      return failureResponse('authentication')
    }

    stage = 'request'
    let payloadRequest: unknown
    try {
      payloadRequest = await request.json()
    } catch {
      return failureResponse('invalid-request')
    }
    if (!isPushRequest(payloadRequest)) return failureResponse('invalid-request')

    const callerId = userData.user.id
    let targetUser = callerId
    let title = 'A test love letter arrived ♡'
    let body = 'Your background notifications are working. The tiny mail carrier made it!'
    let tag = `bobo-test-${Date.now()}`
    let route = '#/inbox'

    if (payloadRequest.event !== 'test') {
      stage = 'invitation'
      const { data: invitation, error: invitationError } = await admin
        .from('date_invitations')
        .select('*')
        .eq('id', payloadRequest.invitationId)
        .maybeSingle()
      if (invitationError) throw new Error(invitationError.message)
      if (!invitation) return failureResponse('invalid-request')

      targetUser = payloadRequest.event === 'invited' ? invitation.recipient_id : invitation.sender_id
      const allowedCaller = payloadRequest.event === 'invited' ? invitation.sender_id : invitation.recipient_id
      if (callerId !== allowedCaller) return failureResponse('authentication')

      title = payloadRequest.event === 'invited'
        ? 'A tiny date invitation arrived ♡'
        : 'Your date invitation has an answer ♡'
      body = payloadRequest.event === 'invited'
        ? 'Open your love mailbox to see what your person planned.'
        : `The answer is: ${String(invitation.status).replace('_', ' ')}.`
      tag = `bobo-invite-${invitation.id}`
      route = `#/invite/${invitation.id}`
    }

    stage = 'configuration'
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    stage = 'subscriptions'
    let subscriptionQuery = admin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', targetUser)
    if (payloadRequest.event === 'test') {
      subscriptionQuery = subscriptionQuery.eq('endpoint', payloadRequest.endpoint)
    }
    const { data: subscriptions, error: subscriptionError } = await subscriptionQuery
    if (subscriptionError) throw subscriptionError

    if (!subscriptions?.length) {
      console.log(`Love-mail push has no registered subscription for event=${payloadRequest.event}`)
      return Response.json(
        { attempted: 0, accepted: 0, expired: 0, failed: 0, reason: 'no-subscription' },
        { headers: corsHeaders },
      )
    }

    const notificationPayload = JSON.stringify(buildDeclarativePushPayload({
      title,
      body,
      tag,
      route,
      baseUrl: parsedBaseUrl.href,
    }))
    const topic = payloadRequest.event === 'test'
      ? 'bobo-test'
      : `invite-${tag.replaceAll('-', '').slice(-24)}`

    stage = 'delivery'
    const outcomes = await Promise.all(subscriptions.map(async (subscription): Promise<DeliveryOutcome> => {
      const hash = await endpointHash(subscription.endpoint)
      const device = deviceClass(subscription.user_agent)
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, notificationPayload, { TTL: 86_400, urgency: 'high', topic })
        console.log(`Love-mail gateway accepted endpoint=${hash} device=${device}`)
        return 'accepted'
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await admin.from('push_subscriptions').delete().eq('id', subscription.id)
          if (deleteError) console.error(`Love-mail expired cleanup failed endpoint=${hash} device=${device}`)
          return 'expired'
        }
        const message = error instanceof Error ? error.message.slice(0, 240) : 'Unknown web-push error'
        console.error(`Love-mail gateway failed endpoint=${hash} device=${device} status=${statusCode ?? 'unknown'} message=${message}`)
        return 'failed'
      }
    }))

    const result = {
      attempted: outcomes.length,
      accepted: outcomes.filter((outcome) => outcome === 'accepted').length,
      expired: outcomes.filter((outcome) => outcome === 'expired').length,
      failed: outcomes.filter((outcome) => outcome === 'failed').length,
    }
    const reason = result.failed > 0
      ? 'gateway-failure'
      : undefined
    console.log(`Love-mail push event=${payloadRequest.event} attempted=${result.attempted} accepted=${result.accepted} expired=${result.expired} failed=${result.failed}`)

    return Response.json({ ...result, ...(reason ? { reason } : {}) }, { headers: corsHeaders })
  } catch (error) {
    const code = failureForStage(stage)
    const message = error instanceof Error ? error.message.slice(0, 240) : 'Unknown error'
    console.error(`Love-mail function failed stage=${stage} code=${code} message=${message}`)
    return failureResponse(code)
  }
})
