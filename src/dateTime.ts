import { DateTime, IANAZone } from 'luxon'
import type { DatePlan } from './types'

export const HOST_TIME_ZONE = 'Asia/Amman' as const

const fallbackZones = [
  'Pacific/Honolulu',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Athens',
  'Africa/Cairo',
  'Asia/Amman',
  'Asia/Beirut',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
]

export function detectTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function getTimeZones(detected = detectTimeZone()) {
  const supportedValuesOf = (
    Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
  ).supportedValuesOf
  const zones = supportedValuesOf ? supportedValuesOf('timeZone') : fallbackZones
  return Array.from(new Set([detected, HOST_TIME_ZONE, ...zones])).sort()
}

export function isValidTimeZone(zone: string) {
  return IANAZone.isValidZone(zone)
}

export function getTodayInZone(zone: string) {
  const safeZone = isValidTimeZone(zone) ? zone : 'UTC'
  return DateTime.now().setZone(safeZone).toISODate() ?? ''
}

export function createPlannedDateTime(date: string, time: string, zone: string) {
  if (!date || !time || !isValidTimeZone(zone)) return null
  const timeMatch = time.match(/^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?$/)
  if (!timeMatch) return null
  const value = DateTime.fromISO(`${date}T${time}`, { zone })
  if (!value.isValid) return null

  // Luxon shifts nonexistent DST times forward. Treat those inputs as invalid.
  // Supabase returns PostgreSQL time columns with seconds, while the planner
  // stores minute-precision values, so compare both forms at second precision.
  const expectedTime = `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3] ?? '00'}`
  if (
    value.toFormat('yyyy-MM-dd') !== date ||
    value.toFormat('HH:mm:ss') !== expectedTime
  ) {
    return null
  }
  return value
}

export function validatePlanTime(date: string, time: string, zone: string) {
  const value = createPlannedDateTime(date, time, zone)
  if (!value) return 'Please choose a real date, time, and timezone.'
  if (value <= DateTime.now()) return 'Our date has to be in the future, silly 💗'
  return null
}

function formatDateTime(value: DateTime) {
  return value.toLocaleString({
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export function getPlanTimes(plan: Pick<DatePlan, 'date' | 'time' | 'guestTimeZone'>) {
  const guest = createPlannedDateTime(plan.date, plan.time, plan.guestTimeZone)
  if (!guest) return null
  return {
    guest: formatDateTime(guest),
    host: formatDateTime(guest.setZone(HOST_TIME_ZONE)),
  }
}
