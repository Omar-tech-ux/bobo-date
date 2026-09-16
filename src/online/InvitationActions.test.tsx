import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxPage, InvitationPage } from './OnlinePages'
import { useOnline } from './OnlineContext'
import { InvitationConflictError, type DateInvitation } from './types'

vi.mock('./OnlineContext', () => ({ useOnline: vi.fn() }))
vi.mock('./NotificationSetup', () => ({ NotificationSetup: () => null }))
const cancel = vi.fn()
const reschedule = vi.fn()
const respond = vi.fn()
const ticket: DateInvitation = {
  id: 'ticket', sender_id: 'sender', recipient_id: 'recipient', couple_id: 'couple',
  date: '2099-01-15', time: '18:30:00', activity: 'video-dinner',
  guest_timezone: 'America/New_York', host_timezone: 'Asia/Amman',
  status: 'accepted', latest_proposer_id: 'sender', last_action: 'responded',
  last_actor_id: 'recipient', revision: 1, cancellation_note: null,
  response_note: null, responded_at: null, created_at: '2026-01-01',
}
function setup(invitation = ticket, userId = 'recipient') {
  vi.mocked(useOnline).mockReturnValue({
    configured: true, loading: false, user: { id: userId },
    pairing: { partner: { display_name: 'Lulu' } },
    receivedInvites: userId === 'recipient' ? [invitation] : [],
    sentInvites: userId === 'sender' ? [invitation] : [],
    cancelInvitation: cancel, rescheduleInvitation: reschedule, respondToInvitation: respond,
  } as unknown as ReturnType<typeof useOnline>)
}
beforeEach(() => {
  vi.clearAllMocks()
  cancel.mockResolvedValue({ accepted: 1 })
  reschedule.mockResolvedValue({ accepted: 1 })
  setup()
})
it('confirms cancellation with an optional note and prevents duplicate submissions', async () => {
  const user = userEvent.setup()
  let finish!: (value: unknown) => void
  cancel.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  render(<InvitationPage invitationId='ticket' />)
  await user.click(screen.getByRole('button', { name: 'Cancel date' }))
  await user.type(screen.getByRole('textbox'), 'Missing you already')
  await user.click(screen.getByRole('button', { name: 'Yes, cancel date' }))
  expect(cancel).toHaveBeenCalledWith(ticket, 'Missing you already')
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Keep date' })).toBeDisabled()
  finish({ accepted: 1 })
  expect(await screen.findByText('Your date was canceled ♡')).toBeInTheDocument()
})
it('dismisses cancellation without changing the ticket', async () => {
  const user = userEvent.setup()
  render(<InvitationPage invitationId='ticket' />)
  await user.click(screen.getByRole('button', { name: 'Cancel date' }))
  await user.click(screen.getByRole('button', { name: 'Keep date' }))
  expect(cancel).not.toHaveBeenCalled()
})
it.each(['sender', 'recipient'])('allows cancellation directly in the %s list', async (userId) => {
  setup(ticket, userId)
  render(<InboxPage />)
  const button = screen.getByRole('button', { name: 'Cancel date' })
  expect(button.closest('a')).toBeNull()
  await userEvent.click(button)
  await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel date' }))
  expect(cancel).toHaveBeenCalledWith(ticket, '')
})
it('proposes a new time on the same ticket and warns if push delivery fails', async () => {
  reschedule.mockResolvedValue({ accepted: 0 })
  const user = userEvent.setup()
  render(<InvitationPage invitationId='ticket' />)
  await user.click(screen.getByRole('button', { name: 'Reschedule' }))
  await user.click(screen.getByRole('button', { name: 'Propose new time' }))
  expect(screen.getByRole('alert')).toHaveTextContent('different time')
  expect(reschedule).not.toHaveBeenCalled()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Timezone' }), 'Asia/Amman')
  await user.click(screen.getByRole('button', { name: 'Propose new time' }))
  expect(reschedule).toHaveBeenCalledWith(ticket, { date: ticket.date, time: '18:30', guestTimeZone: 'Asia/Amman' })
  expect(await screen.findByText(/background tap could not reach/)).toBeInTheDocument()
})
it('rejects past times before sending an update', async () => {
  setup({ ...ticket, date: '2000-01-01' })
  render(<InvitationPage invitationId='ticket' />)
  await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
  await userEvent.click(screen.getByRole('button', { name: 'Propose new time' }))
  expect(screen.getByRole('alert')).toHaveTextContent('future')
  expect(reschedule).not.toHaveBeenCalled()
})
it('keeps the form revision when a newer ticket arrives while editing', async () => {
  const { rerender } = render(<InvitationPage invitationId='ticket' />)
  await userEvent.click(screen.getByRole('button', { name: 'Cancel date' }))
  setup({ ...ticket, revision: 2 })
  rerender(<InvitationPage invitationId='ticket' />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'note' } })
  await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel date' }))
  expect(cancel.mock.calls[0][0].revision).toBe(1)
})
it.each(['cancelled', 'declined'] as const)('shows %s history without mutation controls', (status) => {
  setup({ ...ticket, status, cancellation_note: status === 'cancelled' ? 'Little hug' : null })
  render(<InvitationPage invitationId='ticket' />)
  expect(screen.queryByRole('button', { name: 'Cancel date' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument()
  if (status === 'cancelled') expect(screen.getByText('“Little hug”')).toBeInTheDocument()
})
describe('latest proposal', () => {
  it.each(['sender', 'recipient'])('lets %s answer when the other partner proposed', (userId) => {
    setup({ ...ticket, status: 'pending', latest_proposer_id: userId === 'sender' ? 'recipient' : 'sender' }, userId)
    render(<InvitationPage invitationId='ticket' />)
    expect(screen.getByRole('button', { name: 'YES, IT’S A DATE! ♥' })).toBeInTheDocument()
  })
  it('does not let the proposer accept their own proposal', () => {
    setup({ ...ticket, status: 'pending', latest_proposer_id: 'recipient' })
    render(<InvitationPage invitationId='ticket' />)
    expect(screen.queryByRole('button', { name: 'YES, IT’S A DATE! ♥' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('main')).getByText(/Waiting for your person/)).toBeInTheDocument()
  })
})

it('closes a stale form so the refreshed ticket can be reviewed before retrying', async () => {
  cancel.mockRejectedValue(new InvitationConflictError())
  render(<InvitationPage invitationId='ticket' />)
  await userEvent.click(screen.getByRole('button', { name: 'Cancel date' }))
  await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel date' }))
  expect(await screen.findByText('This ticket changed. Please review it and try again.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Yes, cancel date' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel date' })).toBeEnabled()
})
