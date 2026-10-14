import { beforeEach, describe, expect, it, vi } from 'vitest'
import { locationApi, LocationApiError } from './api'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), configured: true }))
vi.mock('../online/supabase', () => ({
  get supabase() { return mocks.configured ? { rpc: mocks.rpc } : null },
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.configured = true
  mocks.rpc.mockResolvedValue({ data: { revision: 4 }, error: null })
})

describe('private location API', () => {
  it('uses authenticated RPCs and sends only the revision and observation', async () => {
    await locationApi.read()
    await locationApi.enable(3)
    await locationApi.publish(4, {
      latitude: 31.95,
      longitude: 35.91,
      accuracy: 70,
      observed_at: '2026-10-15T12:00:00.000Z',
    })
    await locationApi.stop()

    expect(mocks.rpc.mock.calls).toEqual([
      ['get_location_state', undefined],
      ['enable_location_sharing', { p_expected_revision: 3 }],
      ['publish_location', {
        p_expected_revision: 4,
        p_latitude: 31.95,
        p_longitude: 35.91,
        p_accuracy: 70,
        p_observed_at: '2026-10-15T12:00:00.000Z',
      }],
      ['stop_location_sharing', undefined],
    ])
  })

  it('returns server results without fabricating a successful update', async () => {
    const throttled = { status: 'throttled', next_allowed_at: '2026-10-15T12:01:00.000Z' }
    mocks.rpc.mockResolvedValue({ data: throttled, error: null })
    await expect(locationApi.publish(4, {
      latitude: 31.95, longitude: 35.91, accuracy: 70, observed_at: '2026-10-15T12:00:00.000Z',
    })).resolves.toEqual(throttled)
  })

  it('discards server error details that could contain coordinates', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Latitude 31.95 rejected', details: 'Longitude 35.91', hint: 'Sensitive data' },
    })
    const error = await locationApi.read().catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(LocationApiError)
    expect(error).toMatchObject({ code: '42501', message: 'Location sharing could not be updated.' })
    expect(JSON.stringify(error)).not.toMatch(/31\.95|35\.91|Sensitive data/)
  })

  it('sanitizes rejected transport errors as well as returned database errors', async () => {
    mocks.rpc.mockRejectedValue(new Error('Request latitude=31.95&longitude=35.91 failed'))
    const error = await locationApi.read().catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(LocationApiError)
    expect(error).toHaveProperty('message', 'Location sharing could not be updated.')
    expect(String(error)).not.toMatch(/31\.95|35\.91/)
  })

  it('fails closed when Supabase is unavailable', async () => {
    mocks.configured = false
    await expect(locationApi.read()).rejects.toMatchObject({ code: 'unconfigured' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
