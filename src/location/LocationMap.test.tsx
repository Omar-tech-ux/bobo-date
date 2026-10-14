import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LocationMap, { type LocationMapPoint } from './LocationMap'

const leaflet = vi.hoisted(() => {
  const map = { remove: vi.fn(), setView: vi.fn(), fitBounds: vi.fn() }
  const layer = { addTo: vi.fn(), clearLayers: vi.fn() }
  const tile = { on: vi.fn(), addTo: vi.fn() }
  const marker = { bindTooltip: vi.fn(), addTo: vi.fn() }
  const circle = { addTo: vi.fn() }
  return { map, layer, tile, marker, circle, createMap: vi.fn(), tileLayer: vi.fn(), circleMarker: vi.fn(), circleFactory: vi.fn(), bounds: vi.fn() }
})

vi.mock('leaflet', () => ({
  map: leaflet.createMap,
  layerGroup: () => leaflet.layer,
  tileLayer: leaflet.tileLayer,
  circleMarker: leaflet.circleMarker,
  circle: leaflet.circleFactory,
  latLngBounds: leaflet.bounds,
}))

const points: LocationMapPoint[] = [
  { id: 'me', name: 'Michu (you)', latitude: 31.95, longitude: 35.91, accuracy: 75, own: true },
  { id: 'partner', name: '<img src=x onerror=alert(1)>', latitude: 51.5, longitude: -0.12, accuracy: 100, own: false },
]

beforeEach(() => {
  vi.clearAllMocks()
  leaflet.createMap.mockReturnValue(leaflet.map)
  leaflet.layer.addTo.mockReturnValue(leaflet.layer)
  leaflet.tileLayer.mockReturnValue(leaflet.tile)
  leaflet.tile.on.mockReturnValue(leaflet.tile)
  leaflet.tile.addTo.mockReturnValue(leaflet.tile)
  leaflet.circleMarker.mockReturnValue(leaflet.marker)
  leaflet.marker.bindTooltip.mockReturnValue(leaflet.marker)
  leaflet.circleFactory.mockReturnValue(leaflet.circle)
  leaflet.bounds.mockImplementation((positions) => positions)
})

describe('map lifecycle and privacy', () => {
  it('uses attribution, limits tile loading, renders names as text and disables animated motion', () => {
    render(<LocationMap points={points} />)
    expect(leaflet.createMap).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
      zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, inertia: false, scrollWheelZoom: false,
    }))
    expect(leaflet.tileLayer).toHaveBeenCalledWith('https://tile.openstreetmap.org/{z}/{x}/{y}.png', expect.objectContaining({
      attribution: expect.stringContaining('OpenStreetMap'), updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 1,
    }))
    const label = leaflet.marker.bindTooltip.mock.calls[1][0] as HTMLElement
    expect(label.textContent).toBe(points[1].name)
    expect(label.querySelector('img')).toBeNull()
  })

  it('keeps the user’s map position until explicitly recentered and releases the map on unmount', () => {
    const view = render(<LocationMap points={points} />)
    expect(leaflet.map.fitBounds).toHaveBeenCalledOnce()
    view.rerender(<LocationMap points={points.map((point) => ({ ...point }))} />)
    expect(leaflet.layer.clearLayers).toHaveBeenCalledOnce()
    view.rerender(<LocationMap points={[{ ...points[0], latitude: 32 }, points[1]]} />)
    expect(leaflet.map.fitBounds).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Show our locations' }))
    expect(leaflet.map.fitBounds).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(leaflet.map.remove).toHaveBeenCalledOnce()
  })

  it('places points beside each other when they straddle the date line', () => {
    render(<LocationMap points={[{ ...points[0], longitude: 179 }, { ...points[1], longitude: -179 }]} />)
    expect(leaflet.bounds).toHaveBeenCalledWith([[31.95, 179], [51.5, 181]])
  })
})
