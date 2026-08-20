import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import {
  STORY_PROGRESS_KEY,
  loadStoryProgress,
  markGalleryPhotoViewed,
} from '../storage'
import { CinemaPage, GalleryRoomPage, MemoriesPage, ScrapbookPage, WorldPage } from './StoryPages'

beforeEach(() => {
  window.location.hash = ''
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scrapbook journey', () => {
  it('turns through every memory and unlocks the world', () => {
    vi.useFakeTimers()
    render(<ScrapbookPage />)

    expect(screen.getByText('1 / 10')).toBeInTheDocument()
    for (let page = 1; page < 10; page += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next memory' }))
    }
    expect(screen.getByText('10 / 10')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /follow the pawprints/i }))
    expect(loadStoryProgress().scrapbookCompleted).toBe(true)
    act(() => vi.advanceTimersByTime(700))
    expect(window.location.hash).toBe('#/world')
  })

  it('guards the world until the scrapbook has been completed', () => {
    window.location.hash = '#/world'
    render(<App />)
    expect(screen.getByRole('heading', { name: /where should our hearts go/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /turn our scrapbook pages/i })).toHaveAttribute('href', '#/scrapbook')
    expect(screen.queryByRole('link', { name: /follow the kitten/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /our little world/i })).not.toBeInTheDocument()
  })

  it('enters the world after finishing from a guarded world URL', () => {
    vi.useFakeTimers()
    window.location.hash = '#/world'
    render(<App />)
    act(() => {
      window.location.hash = '#/scrapbook'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    for (let page = 1; page < 10; page += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next memory' }))
    }
    fireEvent.click(screen.getByRole('button', { name: /follow the pawprints/i }))
    act(() => vi.advanceTimersByTime(700))

    expect(screen.getByRole('heading', { name: /our little world/i })).toBeInTheDocument()
  })

  it('shows direct routes to every place after the scrapbook unlock', () => {
    window.localStorage.setItem(STORY_PROGRESS_KEY, JSON.stringify({
      scrapbookCompleted: true,
      viewedGalleryIds: [],
    }))
    render(<MemoriesPage />)

    expect(screen.getByRole('link', { name: /turn our scrapbook pages/i })).toHaveAttribute('href', '#/scrapbook')
    expect(screen.getByRole('link', { name: /follow the kitten/i })).toHaveAttribute('href', '#/world')
    expect(screen.getByRole('link', { name: /watch our little movie/i })).toHaveAttribute('href', '#/cinema')
    expect(screen.getByRole('link', { name: /visit the memory room/i })).toHaveAttribute('href', '#/gallery-room')
  })

  it('supports keyboard page turning', () => {
    render(<ScrapbookPage />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 10')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('1 / 10')).toBeInTheDocument()
  })

  it('uses the custom focal points for memories five and eight', () => {
    render(<ScrapbookPage />)

    for (let page = 1; page < 5; page += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next memory' }))
    }
    expect(screen.getByRole('img', { name: /late-night calls/i })).toHaveStyle({
      objectPosition: 'center top',
    })

    for (let page = 5; page < 8; page += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next memory' }))
    }
    expect(screen.getByRole('img', { name: /distance is worth it/i })).toHaveStyle({
      objectPosition: 'center 72%',
    })
  })
})

describe('walkable world and rooms', () => {
  it('provides accessible routes through both doors', async () => {
    const user = userEvent.setup()
    render(<WorldPage />)

    expect(screen.getByRole('img', { name: /tiny white cat/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /our places/i })).toHaveAttribute('href', '#/memories')
    expect(screen.getByRole('button', { name: /left door cinema/i })).toHaveAttribute('data-sound', 'door')
    await user.click(screen.getByRole('button', { name: /left door cinema/i }))
    expect(window.location.hash).toBe('#/cinema')
  })

  it('shows a graceful fallback when the movie file is missing', () => {
    const { container } = render(<CinemaPage />)
    const audience = Array.from(container.querySelectorAll<HTMLElement>('[data-animal]'))
      .map((seat) => seat.dataset.animal)
    expect(audience).toEqual(['hamster', 'hamster', 'kitten', 'kitten', 'duck', 'puppy', 'puppy'])
    const video = screen.getByLabelText('Our little movie')
    expect(video).toHaveAttribute('autoplay')
    expect(video).toHaveAttribute('playsinline')
    expect(video).toHaveAttribute('preload', 'auto')
    const onThemePause = vi.fn()
    const onThemeResume = vi.fn()
    window.addEventListener('bobo-cinema-play', onThemePause)
    window.addEventListener('bobo-cinema-stop', onThemeResume)
    fireEvent.play(video)
    fireEvent.pause(video)
    expect(onThemePause).toHaveBeenCalledOnce()
    expect(onThemeResume).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('cinema-lily-finale')).not.toBeInTheDocument()
    fireEvent.ended(video)
    expect(screen.getByTestId('cinema-lily-finale')).toBeInTheDocument()
    fireEvent.play(video)
    expect(screen.queryByTestId('cinema-lily-finale')).not.toBeInTheDocument()
    window.removeEventListener('bobo-cinema-play', onThemePause)
    window.removeEventListener('bobo-cinema-stop', onThemeResume)
    fireEvent.error(video)
    expect(screen.getByText(/movie is coming soon/i)).toBeInTheDocument()
  })

  it('unlocks the letter only after all gallery frames are viewed', async () => {
    const user = userEvent.setup()
    render(<GalleryRoomPage />)
    const letter = screen.getByRole('button', { name: /memories found/i })
    expect(letter).toBeDisabled()

    for (const index of [1, 2, 3]) {
      await user.click(screen.getByRole('button', { name: new RegExp(`memory ${index}`, 'i') }))
      await user.click(screen.getByRole('button', { name: /close photo/i }))
    }

    const unlockedLetter = screen.getByRole('button', { name: /a letter for bobo/i })
    expect(unlockedLetter).toBeEnabled()
    await user.click(unlockedLetter)
    expect(screen.getByRole('heading', { name: 'My Bobo,' })).toBeInTheDocument()
  })
})

describe('story progress storage', () => {
  it('recovers from malformed data and deduplicates viewed photos', () => {
    window.localStorage.setItem(STORY_PROGRESS_KEY, '{broken')
    expect(loadStoryProgress()).toEqual({ scrapbookCompleted: false, viewedGalleryIds: [] })

    markGalleryPhotoViewed('photo-one')
    markGalleryPhotoViewed('photo-one')
    expect(loadStoryProgress().viewedGalleryIds).toEqual(['photo-one'])
  })
})
