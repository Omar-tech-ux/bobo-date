import { describe, expect, it } from 'vitest'
import { buildLoveMailNotification } from '../../supabase/functions/_shared/loveMailNotification'

describe('existing love-mail notification contract', () => {
  it('preserves the test notification content, route, and topic', () => {
    expect(buildLoveMailNotification({ event: 'test', now: 123 })).toEqual({
      title: 'A test love letter arrived ♡',
      body: 'Your background notifications are working. The tiny mail carrier made it!',
      tag: 'bobo-test-123',
      route: '#/inbox',
      topic: 'bobo-test',
    })
  })

  it('preserves invitation and response notification content', () => {
    expect(buildLoveMailNotification({ event: 'invited', invitationId: 'invite-123' })).toEqual({
      title: 'A tiny date invitation arrived ♡',
      body: 'Open your love mailbox to see what your person planned.',
      tag: 'bobo-invite-invite-123',
      route: '#/invite/invite-123',
      topic: 'invite-boboinviteinvite123',
    })
    expect(buildLoveMailNotification({
      event: 'responded',
      invitationId: 'invite-123',
      invitationStatus: 'needs_changes',
    })).toMatchObject({
      title: 'Your date invitation has an answer ♡',
      body: 'The answer is: needs changes.',
      tag: 'bobo-invite-invite-123',
      route: '#/invite/invite-123',
    })
  })
})
