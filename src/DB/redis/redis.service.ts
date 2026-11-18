import { redisClient } from "./redis.connection.js"
import { ServiceUnavailableException } from "../../Utils/response/error.response"

type Key = string
type Ttl = number | null

interface KeyArgs {
  key: Key
}

interface SetArgs extends KeyArgs {
  value: unknown
  ttl?: Ttl
}

interface memberArgs {
  userId: string
}

interface GeoArgs extends memberArgs {
  lat: unknown
  lng: unknown
}

interface ExpireArgs extends KeyArgs {
  ttl: number
}

export const revokeTokenKeyPrefix = ({
  userId,
}: {
  userId: string
}): string => {
  return `user:revokeToken:${userId}`
}

export const revokeTokenKey = ({
  userId,
  jti,
}: {
  userId: string
  jti: string
}): string => {
  return `${revokeTokenKeyPrefix({ userId })}:${jti}`
}

export interface DriverLocation {
  lng: number
  lat: number
  heading?: number
  updatedAt: string
}

export interface DriverActiveRide {
  rideId: string
  riderId: string
  // Present only while the driver is heading to the pickup ("accepted"); drives automatic arrival.
  pickup?: { lng: number; lat: number }
}

const DRIVER_LOCATION_TTL_SECONDS = 120
// Leak guard only; the key is deleted when the ride ends.
const DRIVER_ACTIVE_RIDE_TTL_SECONDS = 12 * 60 * 60

export const driverLocationKey = (driverId: string): string =>
  `driver:lastLocation:${driverId}`
export const driverActiveRideKey = (driverId: string): string =>
  `driver:activeRide:${driverId}`

const parseJson = <T>(raw: string | null): T | null => {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const setDriverLocation = (driverId: string, location: DriverLocation) =>
  set({
    key: driverLocationKey(driverId),
    value: location,
    ttl: DRIVER_LOCATION_TTL_SECONDS,
  })

export const getDriverLocation = async (
  driverId: string,
): Promise<DriverLocation | null> =>
  parseJson<DriverLocation>(await get({ key: driverLocationKey(driverId) }))

export const setDriverActiveRide = (driverId: string, ride: DriverActiveRide) =>
  set({
    key: driverActiveRideKey(driverId),
    value: ride,
    ttl: DRIVER_ACTIVE_RIDE_TTL_SECONDS,
  })

export const getDriverActiveRide = async (
  driverId: string,
): Promise<DriverActiveRide | null> =>
  parseJson<DriverActiveRide>(await get({ key: driverActiveRideKey(driverId) }))

export const clearDriverActiveRide = (driverId: string) =>
  del({ key: driverActiveRideKey(driverId) })

// Unlike the helpers below, this fails closed: a Redis outage must not let revoked tokens through.
export const isTokenRevoked = async ({
  userId,
  jti,
}: {
  userId: string
  jti: string
}): Promise<boolean> => {
  if (!redisClient.isReady)
    throw new ServiceUnavailableException(
      "Authentication temporarily unavailable",
    )
  try {
    return (await redisClient.exists(revokeTokenKey({ userId, jti }))) === 1
  } catch (error: unknown) {
    console.error("Redis isTokenRevoked Error:", error)
    throw new ServiceUnavailableException(
      "Authentication temporarily unavailable",
    )
  }
}

const serialize = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value)

const numberify = (value: unknown): number | undefined => {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

export const set = async ({ key, value, ttl = null }: SetArgs) => {
  try {
    const data = serialize(value)
    if (ttl) {
      return await redisClient.set(key, data, {
        expiration: { type: "EX", value: ttl },
      })
    }
    return await redisClient.set(key, data)
  } catch (error: unknown) {
    console.error("Redis Set Error:", error)
    return null
  }
}

// 0 is a valid coordinate, so check for undefined rather than truthiness.
const toGeo = (
  lng: unknown,
  lat: unknown,
): { longitude: number; latitude: number } | null => {
  const longitude = numberify(lng)
  const latitude = numberify(lat)
  if (longitude === undefined || latitude === undefined) return null
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > 85.05112878) return null
  return { longitude, latitude }
}

export const geoSet = async ({ userId, lng, lat }: GeoArgs) => {
  try {
    const geo = toGeo(lng, lat)
    if (!geo) return
    return await redisClient.geoAdd("online:users", { ...geo, member: userId })
  } catch (error: unknown) {
    console.error("Redis geoSet Error:", error)
    return null
  }
}

export const geoUpdate = async ({ userId, lng, lat }: GeoArgs) => {
  try {
    const geo = toGeo(lng, lat)
    if (!geo) return
    return await redisClient.geoAdd(
      "online:users",
      { ...geo, member: userId },
      { condition: "XX" },
    )
  } catch (error: unknown) {
    console.error("Redis geoUpdate Error:", error)
    return null
  }
}

export const geoDel = async ({ userId }: memberArgs) => {
  try {
    return await redisClient.zRem("online:users", userId)
  } catch (error: unknown) {
    console.error("Redis zRem Error:", error)
    return null
  }
}

export const statusGet = async ({ userId }: memberArgs) => {
  try {
    const score = await redisClient.zScore("online:users", userId)
    const isOnline = score !== null
    return isOnline
  } catch (error: unknown) {
    console.error("Redis zScore Error:", error)
    return null
  }
}

export const geoGet = async ({ userId }: memberArgs) => {
  try {
    return await redisClient.geoPos("online:users", userId)
  } catch (error: unknown) {
    console.error("Redis zScore Error:", error)
    return null
  }
}

export const update = async ({ key, value, ttl = null }: SetArgs) => {
  try {
    const isExists = await redisClient.exists(key)
    if (!isExists) return false
    const data = serialize(value)
    if (ttl) {
      return await redisClient.set(key, data, {
        expiration: { type: "EX", value: ttl },
      })
    }
    return await redisClient.set(key, data)
  } catch (error: unknown) {
    console.error("Redis Update Error:", error)
    return false
  }
}

export const get = async ({ key }: KeyArgs) => {
  try {
    return await redisClient.get(key)
  } catch (error: unknown) {
    console.error("Redis Get Error:", error)
    return null
  }
}

export const del = async ({ key }: KeyArgs) => {
  try {
    const isExists = await redisClient.exists(key)
    if (!isExists) return false
    return await redisClient.del(key)
  } catch (error: unknown) {
    console.error("Redis Delete Error:", error)
    return false
  }
}

export const expire = async ({ key, ttl }: ExpireArgs) => {
  try {
    const isExists = await redisClient.exists(key)
    if (!isExists) return false
    return await redisClient.expire(key, ttl)
  } catch (error: unknown) {
    console.error("Redis Expire Error:", error)
    return false
  }
}

export const ttl = async ({ key }: KeyArgs) => {
  try {
    const isExists = await redisClient.exists(key)
    if (!isExists) return false
    return await redisClient.ttl(key)
  } catch (error: unknown) {
    console.error("Redis TTL Error:", error)
    return false
  }
}

export const keys = async ({ pattern }: { pattern: string }) => {
  try {
    return await redisClient.keys(pattern)
  } catch (error: unknown) {
    console.error("Redis Keys Error:", error)
    return null
  }
}
