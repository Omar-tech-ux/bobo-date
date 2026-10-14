import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { anniversaryDateForMonth, anniversaryMonths, latestAnniversaryDate } from './dates'
import { scaledDimensions, validatePhotoFile } from './images'

describe('anniversary calendar', () => {
  it('opens the first month at midnight on October 15 in Amman, regardless of input timezone', () => {
    expect(latestAnniversaryDate(DateTime.fromISO('2026-10-14T20:59:59Z'))).toBeNull()
    expect(latestAnniversaryDate(DateTime.fromISO('2026-10-14T21:00:00Z'))).toBe('2026-10-14')
    expect(latestAnniversaryDate(DateTime.fromISO('2026-09-25T12:00:00Z'))).toBeNull()
  })
  it('keeps the newest due month through the following 14th and handles year rollover', () => {
    expect(latestAnniversaryDate(DateTime.fromISO('2027-01-14T20:59:59Z'))).toBe('2026-12-14')
    expect(latestAnniversaryDate(DateTime.fromISO('2027-01-14T21:00:00Z'))).toBe('2027-01-14')
    expect(latestAnniversaryDate(DateTime.fromISO('2027-02-05T10:00:00Z'))).toBe('2027-01-14')
  })
  it('lists every eligible month newest first, including gaps', () => {
    expect(anniversaryMonths('2027-01-14')).toEqual(['2027-01-14', '2026-12-14', '2026-11-14', '2026-10-14'])
    expect(anniversaryMonths(null)).toEqual([])
  })
  it('rejects invalid and pre-feature detail months', () => {
    expect(anniversaryDateForMonth('2026-10')).toBe('2026-10-14')
    for (const month of ['2026-09', '2026-00', '2026-13', '2026-1', '2026-10/extra', 'not-a-month']) expect(anniversaryDateForMonth(month)).toBeNull()
  })
})

describe('photo preparation limits', () => {
  it('scales portrait and landscape without upscaling small photos', () => {
    expect(scaledDimensions(6000, 4000)).toEqual({ width: 2560, height: 1707 })
    expect(scaledDimensions(3000, 6000)).toEqual({ width: 1280, height: 2560 })
    expect(scaledDimensions(300, 400)).toEqual({ width: 300, height: 400 })
  })
  it('accepts the supported photos and rejects unsupported, empty, and oversized files', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) expect(() => validatePhotoFile(new File(['pixels'], 'photo', { type }))).not.toThrow()
    expect(() => validatePhotoFile(new File(['image'], 'photo.heic', { type: 'image/heic' }))).toThrow(/JPEG/)
    expect(() => validatePhotoFile(new File([], 'empty.jpg', { type: 'image/jpeg' }))).toThrow(/20 MB/)
    const huge = new File(['x'], 'huge.jpg', { type: 'image/jpeg' })
    Object.defineProperty(huge, 'size', { value: 21 * 1024 * 1024 })
    expect(() => validatePhotoFile(huge)).toThrow(/20 MB/)
  })
})
