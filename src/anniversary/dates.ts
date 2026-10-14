import { DateTime } from 'luxon'
import { HOST_TIME_ZONE } from '../dateTime'

export const FIRST_ANNIVERSARY_DATE = '2026-10-14'

export function anniversaryDateForMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null
  const date = `${month}-14`
  return date >= FIRST_ANNIVERSARY_DATE ? date : null
}

// The server uses this same calendar rule; device time is never an upload authority.
export function latestAnniversaryDate(now: DateTime = DateTime.now()) {
  const local = now.setZone(HOST_TIME_ZONE)
  if (!local.isValid) return null
  const due = (local.day >= 15 ? local : local.minus({ months: 1 })).set({ day: 14 }).toISODate()
  return due && due >= FIRST_ANNIVERSARY_DATE ? due : null
}

export function anniversaryMonths(latest: string | null) {
  const months: string[] = []
  if (!latest) return months
  let cursor = DateTime.fromISO(latest, { zone: HOST_TIME_ZONE })
  while (cursor.isValid && cursor.toISODate()! >= FIRST_ANNIVERSARY_DATE) {
    months.push(cursor.toISODate()!)
    cursor = cursor.minus({ months: 1 })
  }
  return months
}

export function anniversaryLabel(date: string) {
  return DateTime.fromISO(date, { zone: HOST_TIME_ZONE }).toFormat('MMMM d, yyyy')
}
