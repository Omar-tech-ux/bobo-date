export const ANNIVERSARY_DAY = 14
export const ANNIVERSARY_ROUTE = '#/plan'
export const ANNIVERSARY_RETRY_WINDOW_MINUTES = 15

export type AnniversarySlot = 'midnight' | 'morning'

export type AnniversaryOccurrence = {
  slot: AnniversarySlot
  localDate: string
  title: string
  body: string
  route: typeof ANNIVERSARY_ROUTE
  tag: string
  topic: string
  ttlSeconds: number
}

export type AnniversaryCoupleMember = {
  couple_id: string
  user_id: string
}

type LocalDateTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const messageBySlot: Record<AnniversarySlot, { title: string; body: string }> = {
  midnight: {
    title: 'Happy anniversary, my love ♡',
    body: 'It’s the 14th—another month of us.',
  },
  morning: {
    title: 'Good morning, my bobo—it’s our anniversary ♡',
    body: 'Tap to plan a little date together.',
  },
}

async function digestSecret(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

export async function anniversaryAutomationSecretsMatch(actual: string | null, expected: string) {
  if (!actual) return false
  const [actualDigest, expectedDigest] = await Promise.all([digestSecret(actual), digestSecret(expected)])
  let difference = 0
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= actualDigest[index] ^ expectedDigest[index]
  }
  return difference === 0
}

export function groupSubscriptionsByCouple<T extends { user_id: string }>(
  members: AnniversaryCoupleMember[],
  subscriptions: T[],
) {
  const coupleByUser = new Map(members.map(({ couple_id, user_id }) => [user_id, couple_id]))
  const grouped = new Map<string, T[]>()
  for (const subscription of subscriptions) {
    const coupleId = coupleByUser.get(subscription.user_id)
    if (!coupleId) continue
    const current = grouped.get(coupleId) ?? []
    current.push(subscription)
    grouped.set(coupleId, current)
  }
  return grouped
}

function localDateTime(now: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  }
}

function dateKey(value: Pick<LocalDateTime, 'year' | 'month' | 'day'>) {
  return [value.year, value.month, value.day]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join('-')
}

function secondsUntilNextLocalDate(now: Date, timeZone: string, currentDate: string) {
  let lower = now.getTime()
  let upper = lower + 36 * 60 * 60 * 1000
  while (dateKey(localDateTime(new Date(upper), timeZone)) === currentDate) {
    upper += 12 * 60 * 60 * 1000
  }

  while (upper - lower > 1_000) {
    const middle = Math.floor((lower + upper) / 2)
    if (dateKey(localDateTime(new Date(middle), timeZone)) === currentDate) lower = middle
    else upper = middle
  }
  return Math.max(1, Math.floor((upper - now.getTime()) / 1_000))
}

export function getAnniversaryOccurrence(now: Date, timeZone: string): AnniversaryOccurrence | null {
  const local = localDateTime(now, timeZone)
  if (local.day !== ANNIVERSARY_DAY || local.minute >= ANNIVERSARY_RETRY_WINDOW_MINUTES) return null

  const slot: AnniversarySlot | null = local.hour === 0
    ? 'midnight'
    : local.hour === 10
      ? 'morning'
      : null
  if (!slot) return null

  const localDate = dateKey(local)
  const message = messageBySlot[slot]
  return {
    slot,
    localDate,
    ...message,
    route: ANNIVERSARY_ROUTE,
    tag: `bobo-anniversary-${localDate}-${slot}`,
    topic: `anniv-${localDate.replaceAll('-', '')}-${slot}`,
    ttlSeconds: secondsUntilNextLocalDate(now, timeZone, localDate),
  }
}
