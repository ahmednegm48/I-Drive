import { Types } from "mongoose"
import { RideModel } from "../../DB/models/ride.model"
import { redisClient } from "../../DB/redis/redis.connection"
import { del } from "../../DB/redis/redis.service"
import { getIo } from "../../Utils/socket/socket.service"
import { CancelledByEnum, RideStatusEnum } from "../../Utils/enums/user.enum"

// How long a requested ride is offered to drivers before it expires.
export const REQUEST_TTL_SECONDS = 120
const SWEEP_INTERVAL_MS = 15_000
const SWEEP_BATCH_SIZE = 100

export const requestKey = (rideId: string): string => `ride:request:${rideId}`
// Drivers a request was broadcast to, kept past the request TTL so expiry can still reach them.
export const offersKey = (rideId: string): string => `ride:offers:${rideId}`
export const OFFERS_TTL_SECONDS = REQUEST_TTL_SECONDS + 600

export const requestCutoff = (): Date =>
  new Date(Date.now() - REQUEST_TTL_SECONDS * 1000)

// requested -> expired, atomically. Returns false if the ride was accepted/cancelled/expired first
export const expireRide = async (rideId: string): Promise<boolean> => {
  const ride = await RideModel.findOneAndUpdate(
    {
      _id: rideId,
      status: RideStatusEnum.REQUESTED,
      createdAt: { $lte: requestCutoff() },
    },
    {
      $set: {
        status: RideStatusEnum.EXPIRED,
        cancelledBy: CancelledByEnum.SYSTEM,
        cancelledAt: new Date(),
      },
    },
    { returnDocument: "after" },
  ).lean()
  if (!ride) return false

  // Side effects: never undo the expiry from here on
  try {
    await Promise.all([
      del({ key: requestKey(rideId) }),
      withdrawOffers(rideId, "expired"),
    ])
    getIo()?.to(ride.riderId.toString()).emit("ride:expired", {
      rideId,
      status: ride.status,
      cancelledAt: ride.cancelledAt,
    })
  } catch (err) {
    console.error("expire side effects failed", err)
  }
  return true
}

// Tells every driver the request was broadcast to that the offer is gone, then forgets them.
export const withdrawOffers = async (
  rideId: string,
  reason: "expired" | "cancelled" | "taken",
  exceptDriverId?: string,
): Promise<void> => {
  try {
    const driverIds = await redisClient.sMembers(offersKey(rideId))
    await del({ key: offersKey(rideId) })
    const io = getIo()
    for (const driverId of driverIds) {
      if (driverId === exceptDriverId) continue
      io?.to(driverId).emit("ride:unavailable", { rideId, reason })
    }
  } catch (err) {
    console.error(`withdrawing offers (${reason}) failed`, err)
  }
}

// Expires every overdue requested ride, optionally only one rider's.
export const expireStaleRideRequests = async ({
  riderId,
}: { riderId?: Types.ObjectId } = {}): Promise<number> => {
  const stale = await RideModel.find({
    status: RideStatusEnum.REQUESTED,
    createdAt: { $lte: requestCutoff() },
    ...(riderId && { riderId }),
  })
    .select("_id")
    .limit(SWEEP_BATCH_SIZE)
    .lean()

  let expired = 0
  for (const { _id } of stale) {
    if (await expireRide(_id.toString())) expired++
  }
  return expired
}

export const startRideExpiryJob = (): NodeJS.Timeout => {
  let running = false
  const timer = setInterval(async () => {
    if (running) return // previous sweep still going
    running = true
    try {
      const expired = await expireStaleRideRequests()
      if (expired) console.log(`[ride-expiry] expired ${expired} ride request(s)`)
    } catch (err) {
      console.error("[ride-expiry] sweep failed", err)
    } finally {
      running = false
    }
  }, SWEEP_INTERVAL_MS)
  timer.unref()
  return timer
}
