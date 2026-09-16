import { describe, expect, it } from 'vitest'
import { invitationNotificationTarget } from '../../supabase/functions/_shared/invitationNotificationTarget'
import { buildLoveMailNotification } from '../../supabase/functions/_shared/loveMailNotification'
import { canChangeInvitation, needsInvitationAnswer, type DateInvitation } from './types'

const ticket = {
  sender_id: 'sender', recipient_id: 'recipient', latest_proposer_id: 'recipient',
  last_actor_id: 'recipient', last_action: 'rescheduled', status: 'pending', revision: 2,
} as DateInvitation

describe('invitation changes', () => {
  it('assigns the pending answer to the other partner without changing inbox ownership', () => {
    expect(needsInvitationAnswer(ticket, 'sender')).toBe(true)
    expect(needsInvitationAnswer(ticket, 'recipient')).toBe(false)
    expect(needsInvitationAnswer(ticket, 'stranger')).toBe(false)
    expect(needsInvitationAnswer({ ...ticket, status: 'cancelled' }, 'sender')).toBe(false)
  })
  it.each(['pending', 'accepted', 'needs_changes'] as const)('allows changing %s tickets, including past dates', (status) => {
    expect(canChangeInvitation({ ...ticket, status, date: '2000-01-01' })).toBe(true)
  })
  it.each(['declined', 'cancelled'] as const)('keeps %s tickets closed', (status) => {
    expect(canChangeInvitation({ ...ticket, status })).toBe(false)
  })
  it('sends proposals to the other partner and their answer to the latest proposer', () => {
    expect(invitationNotificationTarget(ticket, 'recipient', 'rescheduled', 2)).toBe('sender')
    expect(invitationNotificationTarget({ ...ticket, latest_proposer_id: 'sender', last_actor_id: 'sender' }, 'sender', 'rescheduled', 2)).toBe('recipient')
    expect(invitationNotificationTarget({ ...ticket, last_actor_id: 'sender', last_action: 'responded', status: 'accepted' }, 'sender', 'responded', 2)).toBe('recipient')
  })
  it('rejects uncommitted, stale, forged and missing-revision notifications', () => {
    expect(invitationNotificationTarget(ticket, 'stranger', 'rescheduled', 2)).toBeNull()
    expect(invitationNotificationTarget(ticket, 'sender', 'rescheduled', 2)).toBeNull()
    expect(invitationNotificationTarget(ticket, 'recipient', 'cancelled', 2)).toBeNull()
    expect(invitationNotificationTarget(ticket, 'recipient', 'rescheduled', 1)).toBeNull()
    expect(invitationNotificationTarget(ticket, 'recipient', 'rescheduled')).toBeNull()
  })
  it.each(['sender', 'recipient'])('notifies the other partner when %s cancels', (caller) => {
    expect(invitationNotificationTarget({ ...ticket, last_action: 'cancelled', status: 'cancelled', last_actor_id: caller }, caller, 'cancelled', 2)).toBe(caller === 'sender' ? 'recipient' : 'sender')
  })
  it('uses the requested cute messages and the same ticket link', () => {
    expect(buildLoveMailNotification({ event: 'cancelled', invitationId: 'abc' })).toMatchObject({
      title: 'Our little date was canceled 🥺',
      body: 'A tiny sad heart today… your person had to cancel our date. Sending you a little hug ♡',
      route: '#/invite/abc',
    })
    expect(buildLoveMailNotification({ event: 'rescheduled', invitationId: 'abc' })).toMatchObject({ title: 'A new time for us ♡', route: '#/invite/abc' })
  })
})
