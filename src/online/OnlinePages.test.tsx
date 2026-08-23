import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvitationPage } from './OnlinePages'
import { useOnline } from './OnlineContext'

vi.mock('./OnlineContext', () => ({
  useOnline: vi.fn(),
}))

const mockedUseOnline = vi.mocked(useOnline)

describe('invitation details', () => {
  beforeEach(() => {
    mockedUseOnline.mockReturnValue({
      loading: false,
      user: { id: 'recipient-id' },
      pairing: {
        coupleId: 'couple-id',
        code: null,
        partner: {
          id: 'sender-id',
          username: 'lulu',
          display_name: 'Lulu<3',
        },
      },
      receivedInvites: [
        {
          id: 'invitation-id',
          couple_id: 'couple-id',
          sender_id: 'sender-id',
          recipient_id: 'recipient-id',
          date: '2027-01-15',
          time: '18:30:00',
          activity: 'video-dinner',
          guest_timezone: 'America/New_York',
          host_timezone: 'Asia/Amman',
          status: 'accepted',
          response_note: null,
          created_at: '2027-01-01T00:00:00.000Z',
          responded_at: '2027-01-02T00:00:00.000Z',
        },
      ],
      sentInvites: [],
      respondToInvitation: vi.fn(),
    } as unknown as ReturnType<typeof useOnline>)
  })

  it('shows the chosen time and its Amman conversion for a database invitation', () => {
    render(<InvitationPage invitationId='invitation-id' />)

    expect(screen.getByText('Their chosen time').nextElementSibling).toHaveTextContent('6:30 PM')
    expect(screen.getByText('Amman time').nextElementSibling).toHaveTextContent('2:30 AM')
  })
})
