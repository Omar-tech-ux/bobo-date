import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { OnlineProvider, useOnline } from './OnlineContext'
import type { DateInvitation } from './types'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), push: vi.fn() }))
vi.mock('./supabase', () => ({
  isOnlineConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'sender' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: mocks.from,
    rpc: mocks.rpc,
    channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel },
    removeChannel: vi.fn(),
  },
}))
vi.mock('./pushNotifications', () => ({
  requestPushDelivery: mocks.push,
  setPendingInvitationBadge: vi.fn(),
  showLiveInvitationNotification: vi.fn(),
  syncExistingPushSubscription: async () => false,
}))
const ticket = {
  id: 'ticket', sender_id: 'sender', recipient_id: 'recipient', couple_id: 'pair',
  status: 'accepted', revision: 1, latest_proposer_id: 'sender',
  date: '2099-01-01', time: '12:00', guest_timezone: 'Asia/Amman',
} as DateInvitation
let current: ReturnType<typeof useOnline>
function Probe() { current = useOnline(); return null }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockImplementation((table: string) => ({ select: () => ({
    eq: () => ({ maybeSingle: async () => ({ data: { id: 'sender' } }) }),
    order: async () => ({ data: table === 'date_invitations' ? [ticket] : [] }),
  }) }))
  mocks.rpc.mockImplementation(async (name: string) => name === 'get_my_pairing'
    ? { data: null }
    : { data: { ...ticket, status: 'cancelled', revision: 2, last_actor_id: 'sender', last_action: 'cancelled' } })
  mocks.push.mockResolvedValue({ accepted: 1 })
})
async function ready() {
  render(<OnlineProvider><Probe /></OnlineProvider>)
  await waitFor(() => expect(current.loading).toBe(false))
}
it('sends a notification only after a successful revision-checked mutation', async () => {
  await ready()
  await act(async () => { await current.cancelInvitation(ticket, 'hug') })
  expect(mocks.rpc).toHaveBeenCalledWith('change_date_invitation', {
    p_invitation_id: 'ticket', p_expected_revision: 1, p_action: 'cancelled', p_note: 'hug',
  })
  expect(mocks.push).toHaveBeenCalledWith({ invitationId: 'ticket', event: 'cancelled', revision: 2 })
})
it('refreshes after a stale action without notifying', async () => {
  await ready()
  mocks.rpc.mockImplementation(async (name: string) => name === 'get_my_pairing'
    ? { data: null } : { error: { code: '40001', message: 'This ticket changed.' } })
  await act(async () => { await expect(current.cancelInvitation(ticket)).rejects.toThrow('This ticket changed.') })
  expect(mocks.push).not.toHaveBeenCalled()
  expect(mocks.from).toHaveBeenCalledTimes(4)
})
it('retains a committed change when push delivery and the following refresh fail', async () => {
  await ready()
  mocks.push.mockResolvedValue({ accepted: 0, failed: 1 })
  mocks.from.mockImplementation(() => { throw new Error('offline') })
  await act(async () => {
    expect(await current.cancelInvitation(ticket)).toMatchObject({ accepted: 0 })
  })
  expect(current.sentInvites[0].status).toBe('cancelled')
})
it('rejects invalid rescheduling before touching the database or notifying', async () => {
  await ready()
  expect(() => current.rescheduleInvitation(ticket, { date: '2000-01-01', time: '12:00', guestTimeZone: 'Asia/Amman' })).toThrow('future')
  expect(mocks.rpc).not.toHaveBeenCalledWith('change_date_invitation', expect.anything())
  expect(mocks.push).not.toHaveBeenCalled()
})
