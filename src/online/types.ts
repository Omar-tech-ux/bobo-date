import type { ActivityId } from '../types'

export type Profile = {
  id: string
  username: string
  display_name: string
  created_at: string
}

export type Partner = Pick<Profile, 'id' | 'username' | 'display_name'>

export type InvitationStatus = 'pending' | 'accepted' | 'needs_changes' | 'declined'

export type DateInvitation = {
  id: string
  couple_id: string
  sender_id: string
  recipient_id: string
  date: string
  time: string
  activity: ActivityId
  guest_timezone: string
  host_timezone: string
  status: InvitationStatus
  response_note: string | null
  created_at: string
  responded_at: string | null
}

export type PairingDetails = {
  coupleId: string | null
  code: string | null
  partner: Partner | null
}
