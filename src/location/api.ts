import { supabase } from '../online/supabase'
import type { LocationApi, LocationSnapshot, PublishResult } from './types'

export class LocationApiError extends Error {
  constructor(readonly code: string) {
    // Database error payloads must never become logs or user-facing location data.
    super('Location sharing could not be updated.')
  }
}

async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new LocationApiError('unconfigured')
  try {
    const { data, error } = await supabase.rpc(name, args)
    if (error) throw new LocationApiError(error.code)
    return data as T
  } catch (error) {
    throw error instanceof LocationApiError ? error : new LocationApiError('network')
  }
}

export const locationApi: LocationApi = {
  read: () => call<LocationSnapshot>('get_location_state'),
  enable: (revision) => call('enable_location_sharing', { p_expected_revision: revision }),
  publish: (revision, fix) => call<PublishResult>('publish_location', {
    p_expected_revision: revision,
    p_latitude: fix.latitude,
    p_longitude: fix.longitude,
    p_accuracy: fix.accuracy,
    p_observed_at: fix.observed_at,
  }),
  stop: () => call('stop_location_sharing'),
}
