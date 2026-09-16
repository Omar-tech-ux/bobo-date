import type { ActivityId } from '../types'

export type Profile = {
  id: string
  username: string
  display_name: string
  created_at: string
}

export type Partner = Pick<Profile, 'id' | 'username' | 'display_name'>

export type InvitationStatus = 'pending' | 'accepted' | 'needs_changes' | 'declined' | 'cancelled'

export type DateInvitation = {
  id: string
  couple_id: string
  sender_id: string
  recipient_id: string
  date: string
  time: string
  activity: ActivityId
  activities?: ActivityId[]
  guest_timezone: string
  host_timezone: string
  status: InvitationStatus
  response_note: string | null
  created_at: string
  latest_proposer_id: string
  cancellation_note: string | null
  last_action: 'invited' | 'responded' | 'cancelled' | 'rescheduled'
  last_actor_id: string
  revision: number
  responded_at: string | null
}

export type PairingDetails = {
  coupleId: string | null
  code: string | null
  partner: Partner | null
}

export type PushDeliveryResult = {
  attempted: number
  accepted: number
  expired: number
  failed: number
  reason?: PushFailureCode
}

export type PushFailureCode =
  | 'authentication'
  | 'invalid-request'
  | 'configuration'
  | 'database'
  | 'no-subscription'
  | 'gateway-failure'
  | 'function-error'

export type InvitationSendResult = {
  invitation: DateInvitation
  notification: PushDeliveryResult
}

export type NotificationSetupKind =
  | 'unsupported'
  | 'installation-required'
  | 'permission-needed'
  | 'denied'
  | 'subscribed'
  | 'delivery-error'

export type NotificationSetupStatus = {
  kind: NotificationSetupKind
  message: string
}

export function canChangeInvitation(invitation: DateInvitation) {
  return ['pending', 'accepted', 'needs_changes'].includes(invitation.status)
}

export function needsInvitationAnswer(invitation: DateInvitation, userId?: string) {
  return Boolean(userId && invitation.status === 'pending'
    && [invitation.sender_id, invitation.recipient_id].includes(userId)
    && (invitation.latest_proposer_id ?? invitation.sender_id) !== userId)
}

export class InvitationConflictError extends Error {
  constructor() {
    super('This ticket changed. Please review it and try again.')
    this.name = 'InvitationConflictError'
  }
}
