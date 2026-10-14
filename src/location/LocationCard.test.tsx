import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocationCard } from './LocationCard'
import { useLocation } from './LocationContext'
import { useOnline } from '../online/OnlineContext'
import type { LocationState } from './types'

vi.mock('./LocationContext', () => ({ useLocation: vi.fn() }))
vi.mock('../online/OnlineContext', () => ({ useOnline: vi.fn() }))
const map = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn() }))
vi.mock('./LocationMap', () => {
  map.load()
  return { default: (props: { points: unknown[] }) => {
    map.render(props)
    return <div data-testid='location-map'>Our map</div>
  } }
})

const now = Date.parse('2026-10-15T12:00:00Z')
const own: LocationState = {
  user_id: 'me', sharing_enabled: true, latitude: 31.9539, longitude: 35.9106,
  accuracy: 75, observed_at: '2026-10-15T11:59:00Z', expires_at: '2026-10-16T11:59:00Z',
}
const partner: LocationState = {
  ...own, user_id: 'partner', latitude: 51.5072, longitude: -0.1276,
  observed_at: '2026-10-15T11:00:00Z', expires_at: '2026-10-16T11:00:00Z',
}

function setLocation(patch: Partial<ReturnType<typeof useLocation>>) {
  vi.mocked(useLocation).mockReturnValue({ ...vi.mocked(useLocation)(), ...patch })
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn() } })
  vi.mocked(useOnline).mockReturnValue({
    user: { id: 'me' }, profile: { display_name: 'Michu' },
    pairing: { coupleId: 'couple', partner: { id: 'partner', display_name: 'Leen' } },
  } as ReturnType<typeof useOnline>)
  vi.mocked(useLocation).mockReturnValue({
    available: true, loading: false, error: '', states: [own, partner], sharing: false,
    busy: false, pendingStop: false, visible: true, now,
    startSharing: vi.fn().mockResolvedValue(undefined),
    stopSharing: vi.fn().mockResolvedValue(undefined),
    updateLocation: vi.fn(), registerSurface: vi.fn(() => vi.fn()),
  })
})

describe('location card privacy and controls', () => {
  it('does not load the map or request geolocation before an explicit action', () => {
    render(<LocationCard />)
    expect(screen.queryByTestId('location-map')).not.toBeInTheDocument()
    expect(map.load).not.toHaveBeenCalled()
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled()
    expect(useLocation().startSharing).not.toHaveBeenCalled()
    expect(screen.getByText(/shares the viewed area/)).toBeInTheDocument()
  })

  it('shows names, age, accuracy and stale-location copy without claiming they are live', () => {
    render(<LocationCard />)
    expect(screen.getByRole('heading', { name: 'Michu (you)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Leen' })).toBeInTheDocument()
    expect(screen.getByText('1 minute ago')).toHaveAttribute('dateTime', own.observed_at)
    expect(screen.getByText('1 hour ago')).toBeInTheDocument()
    expect(screen.getAllByText('Accuracy: about 75 m')).toHaveLength(2)
    expect(screen.getByText(/this person may have moved/)).toBeInTheDocument()
    expect(screen.getByText(/Approximate distance:/)).toBeInTheDocument()
  })

  it('registers and cleans up the viewing surface without starting sharing', () => {
    const cleanup = vi.fn()
    const register = vi.fn(() => cleanup)
    setLocation({ registerSurface: register })
    const view = render(<LocationCard />)
    expect(register).toHaveBeenCalledOnce()
    view.rerender(<LocationCard compact />)
    expect(register).toHaveBeenCalledOnce()
    view.unmount()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('starts only on consent and lets the user revoke sharing enabled on another device', async () => {
    const state = useLocation()
    render(<LocationCard />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share while app is open' })))
    expect(state.startSharing).toHaveBeenCalledOnce()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' })))
    expect(state.stopSharing).toHaveBeenCalledOnce()
  })

  it('keeps stop available during a location update and exposes a failed removal honestly', async () => {
    setLocation({ sharing: true, busy: true })
    const view = render(<LocationCard />)
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeEnabled()
    setLocation({ sharing: false, busy: false, pendingStop: true })
    view.rerender(<LocationCard />)
    expect(screen.getByText(/may still be visible until removal reaches the server/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share while app is open' })).not.toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry removing my location' })))
    expect(useLocation().stopSharing).toHaveBeenCalledOnce()
  })

  it('opens the map on consent, removes it while hidden, and clears consent for a different account', async () => {
    const view = render(<LocationCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Show map' }))
    await screen.findByTestId('location-map')
    expect(map.render).toHaveBeenLastCalledWith(expect.objectContaining({ points: expect.arrayContaining([
      expect.objectContaining({ id: 'me', own: true }), expect.objectContaining({ id: 'partner', own: false }),
    ]) }))
    setLocation({ visible: false })
    view.rerender(<LocationCard />)
    expect(screen.queryByTestId('location-map')).not.toBeInTheDocument()
    setLocation({ visible: true })
    view.rerender(<LocationCard />)
    await screen.findByTestId('location-map')
    vi.mocked(useOnline).mockReturnValue({ ...useOnline(), user: { id: 'new-person' } } as ReturnType<typeof useOnline>)
    view.rerender(<LocationCard />)
    expect(screen.queryByTestId('location-map')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show map' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('excludes expired, unshared and unrelated locations from map data', async () => {
    setLocation({ states: [
      { ...own, expires_at: '2026-10-15T11:00:00Z' },
      { ...partner, sharing_enabled: false },
      { ...own, user_id: 'stranger' },
    ] })
    const view = render(<LocationCard />)
    expect(screen.queryByRole('button', { name: 'Show map' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Approximate distance:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/31.9539/)).not.toBeInTheDocument()
    setLocation({ states: [own, { ...partner, sharing_enabled: false }] })
    view.rerender(<LocationCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Show map' }))
    await waitFor(() => expect(map.render).toHaveBeenLastCalledWith({ points: [expect.objectContaining({ id: 'me' })] }))
  })

  it('keeps partner viewing available without browser geolocation and shows permission errors', () => {
    Reflect.deleteProperty(navigator, 'geolocation')
    setLocation({ error: 'Location permission was denied. Allow it in browser settings and try again.' })
    render(<LocationCard />)
    expect(screen.getByRole('button', { name: 'Share while app is open' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show map' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Location permission was denied')
  })

  it('keeps the viewing surface registered so a failed initial read can recover', () => {
    setLocation({ available: false })
    render(<LocationCard />)
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(useLocation().registerSurface).toHaveBeenCalledOnce()
  })
})
