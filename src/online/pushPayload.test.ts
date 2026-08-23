import { describe, expect, it } from 'vitest'
import { buildDeclarativePushPayload } from '../../supabase/functions/_shared/pushPayload'

describe('declarative web push payload', () => {
  it('includes the WebKit declarative contract and absolute app assets', () => {
    expect(buildDeclarativePushPayload({
      title: 'A tiny date invitation arrived ♡',
      body: 'Open your love mailbox.',
      tag: 'bobo-invite-123',
      route: '#/invite/123',
      baseUrl: 'https://omar-tech-ux.github.io/bobo-date/',
    })).toEqual({
      web_push: 8030,
      notification: {
        title: 'A tiny date invitation arrived ♡',
        body: 'Open your love mailbox.',
        navigate: 'https://omar-tech-ux.github.io/bobo-date/#/invite/123',
        icon: 'https://omar-tech-ux.github.io/bobo-date/icons/bobo-heart-512.png',
        tag: 'bobo-invite-123',
        silent: false,
        app_badge: '1',
        data: { route: '#/invite/123' },
      },
    })
  })
})
