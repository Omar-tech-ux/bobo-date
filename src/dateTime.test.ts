import { DateTime, Settings } from 'luxon'
import { afterEach, describe, expect, it } from 'vitest'
import { createPlannedDateTime, getPlanTimes, validatePlanTime } from './dateTime'

afterEach(() => {
  Settings.now = () => Date.now()
})

describe('date and timezone helpers', () => {
  it('converts a guest time to Amman time', () => {
    const result = getPlanTimes({
      date: '2027-01-15',
      time: '18:30',
      guestTimeZone: 'America/New_York',
    })

    expect(result?.guest).toContain('6:30 PM')
    expect(result?.host).toContain('2:30 AM')
  })

  it('converts a Supabase time value with seconds', () => {
    const result = getPlanTimes({
      date: '2027-01-15',
      time: '18:30:00',
      guestTimeZone: 'America/New_York',
    })

    expect(result?.guest).toContain('6:30 PM')
    expect(result?.host).toContain('2:30 AM')
  })

  it('accepts fractional seconds from PostgreSQL time values', () => {
    expect(createPlannedDateTime(
      '2027-01-15',
      '18:30:00.123456',
      'America/New_York',
    )).not.toBeNull()
  })

  it('handles daylight-saving offsets', () => {
    const winter = createPlannedDateTime('2027-01-15', '18:00', 'America/New_York')
    const summer = createPlannedDateTime('2027-07-15', '18:00', 'America/New_York')

    expect(winter?.setZone('Asia/Amman').hour).toBe(2)
    expect(summer?.setZone('Asia/Amman').hour).toBe(1)
  })

  it('rejects a plan in the past', () => {
    Settings.now = () => Date.parse('2027-05-10T12:00:00Z')
    expect(validatePlanTime('2027-05-09', '18:00', 'UTC')).toContain('future')
  })

  it('rejects a nonexistent DST wall time', () => {
    expect(createPlannedDateTime('2027-03-14', '02:30', 'America/New_York')).toBeNull()
  })
})
