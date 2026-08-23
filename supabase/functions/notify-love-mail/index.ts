import { createClient } from 'npm:@supabase/supabase-js@2'
// @ts-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7'
import { buildLoveMailNotification } from '../_shared/loveMailNotification.ts'
import { buildDeclarativePushPayload } from '../_shared/pushPayload.ts'
import { deliverWebPush } from '../_shared/webPushDelivery.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

type PushRequest =
  | { event: 'test'; endpoint: string }
  | { event: 'invited' | 'responded'; invitationId: string }

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
  if (stage === 'request') return 'invalid-request'
  if (stage === 'configuration') return 'configuration'
  return 'database'
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 240)
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message.slice(0, 240)
  }
  return 'Unknown error'
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
    let notification = buildLoveMailNotification({ event: 'test' })

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

      notification = buildLoveMailNotification({
        event: payloadRequest.event,
        invitationId: invitation.id,
        invitationStatus: invitation.status,
      })
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
      title: notification.title,
      body: notification.body,
      tag: notification.tag,
      route: notification.route,
      baseUrl: parsedBaseUrl.href,
    }))

    stage = 'delivery'
    const { summary: result } = await deliverWebPush({
      subscriptions,
      payload: notificationPayload,
      ttlSeconds: 86_400,
      topic: notification.topic,
      sendNotification: (subscription, payload, options) => webpush.sendNotification(subscription, payload, options),
      deleteExpiredSubscription: async (subscriptionId) => {
        const { error } = await admin.from('push_subscriptions').delete().eq('id', subscriptionId)
        if (error) throw error
      },
      logLabel: 'Love-mail',
    })
    const reason = result.failed > 0
      ? 'gateway-failure'
      : undefined
    console.log(`Love-mail push event=${payloadRequest.event} attempted=${result.attempted} accepted=${result.accepted} expired=${result.expired} failed=${result.failed}`)

    return Response.json({ ...result, ...(reason ? { reason } : {}) }, { headers: corsHeaders })
  } catch (error) {
    const code = failureForStage(stage)
    const message = errorMessage(error)
    console.error(`Love-mail function failed stage=${stage} code=${code} message=${message}`)
    return failureResponse(code)
  }
})
