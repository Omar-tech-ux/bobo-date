export type LocationState = {
  user_id: string
  sharing_enabled: boolean
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  observed_at: string | null
  expires_at: string | null
}

export type LocationSnapshot = {
  available: boolean
  server_time: string
  own_revision: number | null
  states: LocationState[]
}

export type LocationFix = {
  latitude: number
  longitude: number
  accuracy: number
  observed_at: string
}

export type PublishResult = {
  status: 'accepted' | 'throttled' | 'stale'
  next_allowed_at: string
}

export type LocationApi = {
  read: () => Promise<LocationSnapshot>
  enable: (revision: number) => Promise<{ revision: number }>
  publish: (revision: number, fix: LocationFix) => Promise<PublishResult>
  stop: () => Promise<{ revision: number }>
}

export type LocationView = {
  available: boolean
  loading: boolean
  states: LocationState[]
  sharing: boolean
  busy: boolean
  pendingStop: boolean
  visible: boolean
  now: number
  error: string
}
