import { Server } from "socket.io"
import { AuthedSocket } from "./socket.service"
import {
  addConnection,
  parseAccuracy,
  parseHeading,
  parseLocation,
  removeConnection,
} from "./connected.users"
import { env } from "../../config/config.service"
import {
  ArrivingDriver,
  isNearPickup,
  markArrived,
} from "../../modules/Ride/ride.arrival"
import { RoleEnum } from "../enums/user.enum"
import {
  geoUpdate,
  getDriverActiveRide,
  setDriverLocation,
} from "../../DB/redis/redis.service"

type LocationAck = (response: { ok: boolean; reason?: string }) => void

const LOCATION_THROTTLE_MS = 2_000
// Last processed ping per driver (shared by all of a driver's sockets on this instance).
const lastLocationAt = new Map<string, number>()

// Hot path: constant Redis work (GEO update, last-location write, active-ride read), no DB.
const handleDriverLocation = async (
  io: Server,
  driver: ArrivingDriver,
  payload: unknown,
  reply?: LocationAck,
): Promise<void> => {
  const userId = driver._id.toString()
  const location = parseLocation(payload)
  if (!location) return reply?.({ ok: false, reason: "invalid_location" })

  const now = Date.now()
  if (now - (lastLocationAt.get(userId) ?? 0) < LOCATION_THROTTLE_MS)
    return reply?.({ ok: false, reason: "throttled" })
  lastLocationAt.set(userId, now)

  const heading = parseHeading(payload)
  const updatedAt = new Date(now).toISOString()
  const position = {
    lng: location.lng,
    lat: location.lat,
    ...(heading !== undefined && { heading }),
    updatedAt,
  }

  // geoUpdate only moves drivers already on the dispatch map (online); it never adds one.
  const [, , activeRide] = await Promise.all([
    geoUpdate({ userId, lng: location.lng, lat: location.lat }),
    setDriverLocation(userId, position),
    getDriverActiveRide(userId),
  ])
  if (activeRide) {
    io.to(activeRide.riderId).emit("driver:location", {
      rideId: activeRide.rideId,
      ...position,
    })

    // Automatic arrival: pickup is only cached while the ride is "accepted". A fix whose
    // reported accuracy is worse than the radius can't prove the driver is inside it.
    const accuracy = parseAccuracy(payload)
    if (
      activeRide.pickup &&
      (accuracy === undefined || accuracy <= env.ARRIVAL_RADIUS_METERS) &&
      isNearPickup(location, activeRide.pickup)
    ) {
      await markArrived({ rideId: activeRide.rideId, driver, auto: true })
    }
  }
  reply?.({ ok: true })
}

export const connectedSocketsEvent = async (
  io: Server,
  socket: AuthedSocket,
): Promise<void> => {
  const user = socket.user!
  const userId = user._id.toString()
  const isDriver = user.role === RoleEnum.DRIVER

  // Register handlers first so an early return or failure below can't skip them.
  socket.on("disconnect", async () => {
    console.log(`[socket] disconnected: ${user.firstname} (${socket.id})`)
    if (!isDriver) return
    try {
      // The closing socket has already left its rooms, so this counts the others.
      const remaining = await io.in(userId).fetchSockets()
      if (remaining.length) return
      lastLocationAt.delete(userId)
      await removeConnection(userId)
    } catch (err) {
      console.error("[socket] removeConnection failed", err)
    }
  })

  socket.on("driver:location", async (payload: unknown, ack?: unknown) => {
    const reply = typeof ack === "function" ? (ack as LocationAck) : undefined
    if (!isDriver) return reply?.({ ok: false, reason: "not_a_driver" })
    try {
      await handleDriverLocation(io, user, payload, reply)
    } catch (err) {
      console.error("[socket] driver:location failed", err)
      reply?.({ ok: false, reason: "error" })
    }
  })

  // Connecting without a location means "offline": stay off the dispatch map.
  if (isDriver && socket.location) await addConnection(userId, socket.location)
}
