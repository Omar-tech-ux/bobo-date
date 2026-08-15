import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, ProposalPage } from './App'
import { PLAN_STORAGE_KEY, STORY_PROGRESS_KEY } from './storage'

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('proposal experience', () => {
  it('plays the intro and then reveals the proposal', () => {
    vi.useFakeTimers()
    render(<ProposalPage />)
    expect(screen.getByText('HI BOBO...')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(4900))
    expect(screen.getByRole('heading', { name: /will you go on/i })).toBeInTheDocument()
  })

  it('makes Yes grow and changes the sad message when No is pressed', async () => {
    const user = userEvent.setup()
    render(<ProposalPage />)
    await user.click(screen.getByRole('button', { name: /skip intro/i }))
    const yes = screen.getByRole('button', { name: /yes/i })
    expect(yes).toHaveAttribute('data-sound', 'yes')
    expect(screen.getByRole('button', { name: /^no$/i })).toHaveAttribute('data-sound', 'no')
    const initialWidth = yes.style.getPropertyValue('--yes-width')

    await user.click(screen.getByRole('button', { name: /^no$/i }))

    expect(screen.getByText(/tiny ouch/i)).toBeInTheDocument()
    expect(yes.style.getPropertyValue('--yes-width')).not.toBe(initialWidth)
    expect(window.location.hash).toBe('')
  })

  it('opens the terms in a safe new tab', async () => {
    const user = userEvent.setup()
    render(<ProposalPage />)
    await user.click(screen.getByRole('button', { name: /skip intro/i }))
    const link = screen.getByRole('link', { name: /terms & conditions/i })

    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('offers a direct mailbox shortcut from the proposal screen', async () => {
    const user = userEvent.setup()
    render(<ProposalPage />)
    await user.click(screen.getByRole('button', { name: /skip intro/i }))

    expect(screen.getByRole('link', { name: /open our love mailbox/i })).toHaveAttribute('href', '#/account')
  })
})

describe('routing and persistence', () => {
  it('keeps the original theme control available across the app', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /start across the pink sky/i })).toBeInTheDocument()
  })

  it('shows a saved plan on the confirmation route', () => {
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({
      date: '2027-07-15',
      time: '18:00',
      activity: 'movie-night',
      guestTimeZone: 'America/New_York',
      hostTimeZone: 'Asia/Amman',
      createdAt: '2027-01-01T00:00:00.000Z',
    }))
    window.location.hash = '#/confirmed'
    render(<App />)

    expect(screen.getByText('IT’S A DATE!')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Movie watch party' })).toBeInTheDocument()
    expect(screen.getByText(/Amman time/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open our scrapbook/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /visit our little world/i })).not.toBeInTheDocument()
  })

  it('shows a direct world shortcut after the scrapbook is complete', () => {
    window.localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify({
      date: '2027-07-15',
      time: '18:00',
      activity: 'movie-night',
      guestTimeZone: 'America/New_York',
      hostTimeZone: 'Asia/Amman',
      createdAt: '2027-01-01T00:00:00.000Z',
    }))
    window.localStorage.setItem(STORY_PROGRESS_KEY, JSON.stringify({
      scrapbookCompleted: true,
      viewedGalleryIds: [],
    }))
    window.location.hash = '#/confirmed'
    render(<App />)

    expect(screen.getByRole('link', { name: /visit our little world/i })).toBeInTheDocument()
  })

  it('requires an activity before saving', () => {
    window.location.hash = '#/plan'
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'The day' }))
    fireEvent.click(screen.getByRole('button', { name: /next saturday/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Your time' }))
    fireEvent.click(screen.getByRole('button', { name: /set our time/i }))
    fireEvent.click(screen.getByRole('button', { name: /lock in/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/tiny adventure/i)
    expect(window.localStorage.getItem(PLAN_STORAGE_KEY)).toBeNull()
  })

  it('shows a cute custom message instead of native validation when everything is blank', () => {
    window.location.hash = '#/plan'
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /lock in/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/mystery mode/i)
    expect(screen.getByRole('button', { name: 'The day' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Your time' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('uses a different joke for each missing part of the plan', () => {
    window.location.hash = '#/plan'
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'The day' }))
    fireEvent.click(screen.getByRole('button', { name: /next saturday/i }))
    fireEvent.click(screen.getByRole('button', { name: /lock in/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/missing you extra/i)

    fireEvent.click(screen.getByRole('button', { name: 'Your time' }))
    fireEvent.click(screen.getByRole('button', { name: /set our time/i }))
    fireEvent.click(screen.getByRole('button', { name: /lock in/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/popcorn is getting nervous/i)
  })

  it('uses custom pixel pickers for both date and time', () => {
    window.location.hash = '#/plan'
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'The day' }))
    expect(screen.getByRole('dialog', { name: /choose our date/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next saturday/i }))
    expect(screen.queryByRole('dialog', { name: /choose our date/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Your time' }))
    expect(screen.getByRole('dialog', { name: /choose our time/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^8$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^30$/ }))
    fireEvent.click(screen.getByRole('button', { name: /PM/ }))
    fireEvent.click(screen.getByRole('button', { name: /set our time/i }))
    expect(screen.getByRole('button', { name: 'Your time' })).toHaveTextContent('8:30 PM')
  })
})
