import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { activities } from '../types'
import { ActivityList, ActivityTicketHeading } from './ActivityTicketHeading'

describe('activity ticket presentation', () => {
  it.each([1, 2, 5])('renders %s activities with full names', (count) => {
    const chosen = activities.slice(0, count)
    render(<ActivityTicketHeading value={{ activities: chosen.map((item) => item.id) }} className="ticket-top" subtitle="admit two very cute people" />)
    expect(screen.getByRole('heading')).toHaveTextContent(count === 1 ? chosen[0].label : 'Our little date')
    for (const item of chosen) expect(screen.getByText(item.label)).toBeInTheDocument()
    if (count > 1) expect(screen.getAllByRole('listitem')).toHaveLength(count)
  })

  it('keeps all five full names in a compact mailbox list', () => {
    render(<ActivityList value={{ activities: activities.map((item) => item.id) }} compact />)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    for (const item of activities) expect(screen.getByText(item.label)).toBeInTheDocument()
  })
})
