type Point = { latitude: number; longitude: number }

export function distanceMetres(a: Point, b: Point): number {
  const radians = Math.PI / 180
  const latitude = (b.latitude - a.latitude) * radians
  const longitude = (b.longitude - a.longitude) * radians
  const haversine = Math.sin(latitude / 2) ** 2
    + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(longitude / 2) ** 2
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))))
}

export function hasMoved(a: Point & { accuracy: number }, b: Point & { accuracy: number }): boolean {
  return distanceMetres(a, b) > Math.max(100, a.accuracy, b.accuracy)
}
