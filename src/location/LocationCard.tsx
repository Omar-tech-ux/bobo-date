import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { useOnline } from '../online/OnlineContext'
import { useLocation } from './LocationContext'
import { distanceMetres } from './distance'
import type { LocationState } from './types'
import type { LocationMapPoint } from './LocationMap'
import './location.css'

const LocationMap = lazy(() => import('./LocationMap'))
const OLD_LOCATION_MS = 10 * 60 * 1000

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed
      ? <p className='location-map-message' role='status'>The map couldn’t open. Hide it and try again when you’re connected.</p>
      : this.props.children
  }
}

function hasPosition(state: LocationState | undefined, now: number): state is LocationState & {
  latitude: number
  longitude: number
  observed_at: string
} {
  return Boolean(state?.sharing_enabled
    && state.latitude !== null && Number.isFinite(state.latitude) && Math.abs(state.latitude) <= 90
    && state.longitude !== null && Number.isFinite(state.longitude) && Math.abs(state.longitude) <= 180
    && state.observed_at && Number.isFinite(Date.parse(state.observed_at))
    && state.expires_at && Date.parse(state.expires_at) > now)
}

function ageLabel(observedAt: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(observedAt)) / 60_000))
  if (minutes < 1) return 'less than a minute ago'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function distanceLabel(meters: number) {
  if (meters < 100) return 'under 100 m'
  if (meters < 1000) return `${Math.round(meters / 100) * 100} m`
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: meters < 10_000 ? 1 : 0 }).format(meters / 1000)} km`
}

function accuracyLabel(meters: number) {
  return meters < 1000 ? `${Math.max(1, Math.round(meters))} m` : `${Math.round(meters / 100) / 10} km`
}

function PersonLocation({ name, state, now, own }: {
  name: string
  state: LocationState | undefined
  now: number
  own: boolean
}) {
  const positioned = hasPosition(state, now)
  const old = positioned && now - Date.parse(state.observed_at) > OLD_LOCATION_MS

  return (
    <li className={`location-person${own ? ' location-person--you' : ''}`}>
      <span className='location-person-heart' aria-hidden='true'>{own ? '♡' : '♥'}</span>
      <div>
        <h3>{name}{own ? ' (you)' : ''}</h3>
        {positioned ? <>
          <p className='location-person-time'>
            Last shared <time dateTime={state.observed_at} title={new Date(state.observed_at).toLocaleString()}>{ageLabel(state.observed_at, now)}</time>
          </p>
          <p className='location-coordinates'>{state.latitude.toFixed(4)}°, {state.longitude.toFixed(4)}°</p>
          {state.accuracy !== null && Number.isFinite(state.accuracy) && state.accuracy >= 0 && <p className='location-accuracy'>Accuracy: about {accuracyLabel(state.accuracy)}</p>}
          {old && <p className='location-stale'>An older location — this person may have moved.</p>}
        </> : <p className='location-person-time'>
          {state?.sharing_enabled ? 'Waiting for a fresh location.' : 'Location sharing is off.'}
        </p>}
      </div>
    </li>
  )
}

export function LocationCard({ id = 'our-location', compact = false }: { id?: string; compact?: boolean }) {
  const { user, profile, pairing } = useOnline()
  const {
    available, loading, error, states, sharing, busy, pendingStop, visible, now,
    startSharing, stopSharing, updateLocation, registerSurface,
  } = useLocation()
  const [mapConsent, setMapConsent] = useState<string | null>(null)
  const identity = `${user?.id ?? ''}:${pairing.coupleId ?? ''}`
  const showMap = mapConsent === identity

  useEffect(() => registerSurface(), [registerSurface])

  if (!available || !user || !pairing.partner) return null

  const ownState = states.find((state) => state.user_id === user.id)
  const partnerState = states.find((state) => state.user_id === pairing.partner!.id)
  const ownName = profile?.display_name || 'You'
  const partnerName = pairing.partner.display_name
  const points: LocationMapPoint[] = []
  if (hasPosition(ownState, now)) points.push({ id: user.id, name: `${ownName} (you)`, latitude: ownState.latitude, longitude: ownState.longitude, accuracy: ownState.accuracy, own: true })
  if (hasPosition(partnerState, now)) points.push({ id: pairing.partner.id, name: partnerName, latitude: partnerState.latitude, longitude: partnerState.longitude, accuracy: partnerState.accuracy, own: false })
  const canStop = sharing || ownState?.sharing_enabled || pendingStop || busy
  const supported = Boolean(navigator.geolocation)

  return (
    <section id={id} className={`location-card${compact ? ' location-card--compact' : ''}`} aria-labelledby={`${id}-title`}>
      <header className='location-card-heading'>
        <h2 id={`${id}-title`}>A little closer <span aria-hidden='true'>♡</span></h2>
        <p>Our last shared places, just for the two of us.</p>
      </header>
      {loading && <p role='status'>Checking our shared locations…</p>}
      <ul className='location-people' aria-label='Our last shared locations'>
        <PersonLocation name={ownName} state={ownState} now={now} own />
        <PersonLocation name={partnerName} state={partnerState} now={now} own={false} />
      </ul>
      {points.length === 2 && <p className='location-distance'>
        <span aria-hidden='true'>♡ ··· ♥</span> Approximate distance: {distanceLabel(distanceMetres(points[0], points[1]))}
        <span className='location-distance-note'>Straight-line estimate from these last shared locations.</span>
      </p>}
      <div className='location-actions'>
        {!sharing && !pendingStop && <button type='button' className='pixel-button location-button' disabled={busy || !supported} onClick={() => void startSharing()}>
          {busy ? 'Enabling sharing…' : 'Share while app is open'}
        </button>}
        {sharing && <button type='button' className='pixel-button location-button' disabled={busy || !visible} onClick={updateLocation}>
          {busy ? 'Updating…' : 'Update my location'}
        </button>}
        {canStop && <button type='button' className='location-text-button' onClick={() => void stopSharing()}>
          {pendingStop ? 'Retry removing my location' : 'Stop sharing'}
        </button>}
      </div>
      <p className='location-sharing-note'>
        {pendingStop
          ? 'Sharing is stopped on this device. Your last location may still be visible until removal reaches the server.'
          : sharing
            ? 'Sharing while the app is visible. Updates pause when you leave or lock your phone.'
            : 'Sharing is your choice. It only updates while this app is visible.'}
      </p>
      {!supported && <p className='location-notice' role='status'>Location access isn’t available in this browser. You can still see your person’s shared location.</p>}
      {error && <p className='location-notice' role='alert'>{error}</p>}
      {points.length > 0 && <div className='location-map-section'>
        <button className='location-text-button' type='button' aria-expanded={showMap} aria-controls={`${id}-map`} onClick={() => setMapConsent(showMap ? null : identity)}>
          {showMap ? 'Hide map' : 'Show map'}
        </button>
        {!showMap && <p className='location-map-privacy'>Opening the map loads OpenStreetMap tiles and shares the viewed area with its map service.</p>}
        {showMap && visible && <div id={`${id}-map`}>
          <MapBoundary><Suspense fallback={<p className='location-map-message' role='status'>Opening the map…</p>}>
            <LocationMap points={points} />
          </Suspense></MapBoundary>
        </div>}
      </div>}
    </section>
  )
}
