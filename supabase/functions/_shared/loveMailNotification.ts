export type LoveMailEvent = 'test' | 'invited' | 'responded' | 'cancelled' | 'rescheduled'

type LoveMailNotificationInput = {
  event: LoveMailEvent
  invitationId?: string
  invitationStatus?: string
  now?: number
}

export function buildLoveMailNotification({
  event,
  invitationId,
  invitationStatus,
  now = Date.now(),
}: LoveMailNotificationInput) {
  if (event === 'test') {
    return {
      title: 'A test love letter arrived ♡',
      body: 'Your background notifications are working. The tiny mail carrier made it!',
      tag: `bobo-test-${now}`,
      route: '#/inbox',
      topic: 'bobo-test',
    }
  }

  if (!invitationId) throw new Error('Invitation notifications require an invitation id')
  const tag = `bobo-invite-${invitationId}`
  return {
    title: event === 'cancelled'
      ? 'Our little date was canceled 🥺'
      : event === 'rescheduled'
      ? 'A new time for us ♡'
      : event === 'invited'
      ? 'A tiny date invitation arrived ♡'
      : 'Your date invitation has an answer ♡',
    body: event === 'cancelled'
      ? 'A tiny sad heart today… your person had to cancel our date. Sending you a little hug ♡'
      : event === 'rescheduled'
      ? 'Your person proposed a new time for our date. Open your little ticket to say yes ♡'
      : event === 'invited'
      ? 'Open your love mailbox to see what your person planned.'
      : `The answer is: ${String(invitationStatus).replace('_', ' ')}.`,
    tag,
    route: `#/invite/${invitationId}`,
    topic: `invite-${tag.replaceAll('-', '').slice(-24)}`,
  }
}
