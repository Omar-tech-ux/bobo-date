import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

    const { invitationId, event } = await request.json() as {
      invitationId: string
      event: 'invited' | 'responded'
    }

    const admin = createClient(url, serviceRoleKey)
    const { data: invitation, error: invitationError } = await admin
      .from('date_invitations')
      .select('*')
      .eq('id', invitationId)
      .single()
    if (invitationError || !invitation) throw new Error('Invitation not found')

    const callerId = userData.user.id
    const targetUser = event === 'invited' ? invitation.recipient_id : invitation.sender_id
    const allowedCaller = event === 'invited' ? invitation.sender_id : invitation.recipient_id
    if (callerId !== allowedCaller) throw new Error('Not allowed')

    if (!vapidPublicKey || !vapidPrivateKey) {
      return Response.json({ delivered: 0, reason: 'VAPID is not configured' }, { headers: corsHeaders })
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    const { data: subscriptions, error: subscriptionError } = await admin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', targetUser)
    if (subscriptionError) throw subscriptionError

    const title = event === 'invited' ? 'A tiny date invitation arrived ♡' : 'Your date invitation has an answer ♡'
    const body = event === 'invited'
      ? 'Open your love mailbox to see what your person planned.'
      : `The answer is: ${String(invitation.status).replace('_', ' ')}.`
    const payload = JSON.stringify({
      title,
      body,
      icon: './icons/bobo-heart.svg',
      tag: `bobo-invite-${invitation.id}`,
      route: `#/invite/${invitation.id}`,
    })

    let delivered = 0
    await Promise.all((subscriptions ?? []).map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload)
        delivered += 1
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', subscription.id)
        }
      }
    }))

    return Response.json({ delivered }, { headers: corsHeaders })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400, headers: corsHeaders },
    )
  }
})
