export interface LngLat {
  lng: number
  lat: number
}

const EARTH_RADIUS_METERS = 6_371_000
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

// Great-circle distance between two points, in meters.
export const haversineMeters = (a: LngLat, b: LngLat): number => {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h))
}
