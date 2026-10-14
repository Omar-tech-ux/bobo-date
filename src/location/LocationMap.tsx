import { memo, useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type LocationMapPoint = {
  id: string
  name: string
  latitude: number
  longitude: number
  accuracy: number | null
  own: boolean
}

// Keep nearby people together across the international date line.
function positionsFor(points: LocationMapPoint[]): L.LatLngTuple[] {
  const anchor = points[0]?.longitude ?? 0
  return points.map((point) => [point.latitude, point.longitude + Math.round((anchor - point.longitude) / 360) * 360])
}

function fitPeople(map: L.Map, points: LocationMapPoint[]) {
  const positions = positionsFor(points)
  if (positions.length === 1) map.setView(positions[0], 12, { animate: false })
  else if (positions.length > 1) map.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: 13, animate: false })
}

function LocationMap({ points }: { points: LocationMapPoint[] }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(false)
  const [tileError, setTileError] = useState(false)

  useEffect(() => {
    if (!container.current) return
    const map = L.map(container.current, {
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
      scrollWheelZoom: false,
      minZoom: 2,
      maxZoom: 18,
    })
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 1,
    }).on('tileerror', () => setTileError(true)).addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
      fitted.current = false
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const positions = positionsFor(points)
    points.forEach((point, index) => {
      const color = point.own ? '#a92c64' : '#536e49'
      if (point.accuracy !== null && Number.isFinite(point.accuracy) && point.accuracy > 0) {
        L.circle(positions[index], { radius: point.accuracy, color, fillOpacity: 0.08, weight: 1, interactive: false }).addTo(layer)
      }
      const label = document.createElement('span')
      label.textContent = point.name
      L.circleMarker(positions[index], { radius: 9, color: '#672046', fillColor: point.own ? '#e34f8a' : '#e9fff0', fillOpacity: 1, weight: 3 })
        .bindTooltip(label, { permanent: true, direction: 'auto', className: 'location-map-label' })
        .addTo(layer)
    })
    if (!fitted.current && points.length > 0) {
      fitPeople(map, points)
      fitted.current = true
    }
  }, [points])

  return <>
    <div className='location-map-canvas' ref={container} role='region' aria-label='Map of our last shared locations' />
    <div className='location-map-tools'>
      <button className='location-text-button' type='button' onClick={() => mapRef.current && fitPeople(mapRef.current, points)}>Show our locations</button>
      <span>Circles show approximate accuracy.</span>
    </div>
    {tileError && <p className='location-map-message' role='status'>Some map tiles couldn’t load. Your last shared coordinates are still listed above.</p>}
  </>
}

// Age labels update independently; unchanged positions must not rebuild map layers.
export default memo(LocationMap, (previous, next) => previous.points.length === next.points.length
  && previous.points.every((point, index) => {
    const other = next.points[index]
    return point.id === other.id && point.name === other.name && point.own === other.own
      && point.latitude === other.latitude && point.longitude === other.longitude && point.accuracy === other.accuracy
  }))
