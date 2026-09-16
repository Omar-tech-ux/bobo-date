// Derive the recipient only from the committed ticket, never from the request.
export function invitationNotificationTarget(ticket: {
  sender_id: string
  recipient_id: string
  latest_proposer_id: string
  last_actor_id: string
  last_action: string
  status: string
  revision: number
}, callerId: string, event: string, revision?: number): string | null {
  if (![ticket.sender_id, ticket.recipient_id].includes(callerId)) return null
  if (['cancelled', 'rescheduled'].includes(event) && revision === undefined) return null
  if (revision !== undefined && revision !== ticket.revision) return null
  if (ticket.last_action !== event || ticket.last_actor_id !== callerId) return null
  if (event === 'invited' && (callerId !== ticket.sender_id || ticket.status !== 'pending')) return null
  if (event === 'responded' && (callerId === ticket.latest_proposer_id
    || !['accepted', 'needs_changes', 'declined'].includes(ticket.status))) return null
  if (event === 'cancelled' && ticket.status !== 'cancelled') return null
  if (event === 'rescheduled' && (ticket.status !== 'pending' || callerId !== ticket.latest_proposer_id)) return null
  return callerId === ticket.sender_id ? ticket.recipient_id : ticket.sender_id
}
