import { describe, expect, it } from 'vitest'
import {
  anniversaryAutomationSecretsMatch,
  getAnniversaryOccurrence,
  groupSubscriptionsByCouple,
} from '../../supabase/functions/_shared/anniversaryReminder'

describe('anniversary reminder schedule', () => {
  it('resolves Amman midnight across the preceding UTC date boundary', () => {
    const occurrence = getAnniversaryOccurrence(
      new Date('2026-09-13T21:00:00.000Z'),
      'Asia/Amman',
    )

    expect(occurrence).toMatchObject({
      slot: 'midnight',
      localDate: '2026-09-14',
      title: 'Happy anniversary, my love ♡',
      body: 'It’s the 14th—another month of us.',
      route: '#/plan',
      tag: 'bobo-anniversary-2026-09-14-midnight',
      topic: 'anniv-20260914-midnight',
    })
    expect(occurrence!.ttlSeconds).toBeGreaterThanOrEqual(86_398)
    expect(occurrence!.ttlSeconds).toBeLessThanOrEqual(86_400)
  })

  it('builds the distinct 10 AM reminder and expires it at local midnight', () => {
    const occurrence = getAnniversaryOccurrence(
      new Date('2026-09-14T07:00:00.000Z'),
      'Asia/Amman',
    )

    expect(occurrence).toMatchObject({
      slot: 'morning',
      localDate: '2026-09-14',
      title: 'Good morning, my bobo—it’s our anniversary ♡',
      body: 'Tap to plan a little date together.',
      route: '#/plan',
      tag: 'bobo-anniversary-2026-09-14-morning',
      topic: 'anniv-20260914-morning',
    })
    expect(occurrence!.ttlSeconds).toBeGreaterThanOrEqual(50_398)
    expect(occurrence!.ttlSeconds).toBeLessThanOrEqual(50_400)
  })

  it('uses a 15-minute retry window and ignores every other time', () => {
    expect(getAnniversaryOccurrence(new Date('2026-09-13T21:14:59.000Z'), 'Asia/Amman')?.slot).toBe('midnight')
    expect(getAnniversaryOccurrence(new Date('2026-09-13T21:15:00.000Z'), 'Asia/Amman')).toBeNull()
    expect(getAnniversaryOccurrence(new Date('2026-09-14T07:14:59.000Z'), 'Asia/Amman')?.slot).toBe('morning')
    expect(getAnniversaryOccurrence(new Date('2026-09-14T07:15:00.000Z'), 'Asia/Amman')).toBeNull()
    expect(getAnniversaryOccurrence(new Date('2026-09-13T07:00:00.000Z'), 'Asia/Amman')).toBeNull()
    expect(getAnniversaryOccurrence(new Date('2026-09-14T06:00:00.000Z'), 'Asia/Amman')).toBeNull()
  })
})

describe('anniversary automation authentication', () => {
  it('accepts only the configured secret', async () => {
    await expect(anniversaryAutomationSecretsMatch(null, 'configured-secret')).resolves.toBe(false)
    await expect(anniversaryAutomationSecretsMatch('wrong-secret', 'configured-secret')).resolves.toBe(false)
    await expect(anniversaryAutomationSecretsMatch('configured-secret', 'configured-secret')).resolves.toBe(true)
  })
})

describe('anniversary recipients', () => {
  it('groups every registered device for both configured couple members only', () => {
    const grouped = groupSubscriptionsByCouple(
      [
        { couple_id: 'our-couple', user_id: 'me' },
        { couple_id: 'our-couple', user_id: 'bobo' },
      ],
      [
        { id: 'my-phone', user_id: 'me' },
        { id: 'my-laptop', user_id: 'me' },
        { id: 'bobo-phone', user_id: 'bobo' },
        { id: 'someone-else', user_id: 'unrelated' },
      ],
    )

    expect(grouped.get('our-couple')?.map(({ id }) => id)).toEqual([
      'my-phone',
      'my-laptop',
      'bobo-phone',
    ])
    expect([...grouped.values()].flat()).not.toContainEqual(expect.objectContaining({ id: 'someone-else' }))
  })
})
