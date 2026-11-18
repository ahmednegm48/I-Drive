import { env } from "../../config/config.service"
import { DriverModel, IVehicle } from "../../DB/models/driver.model"
import { RideModel } from "../../DB/models/ride.model"
import { IUser } from "../../DB/models/user.model"
import {
  del,
  get,
  getDriverLocation,
  setDriverActiveRide,
} from "../../DB/redis/redis.service"
import { RideStatusEnum } from "../../Utils/enums/user.enum"
import { haversineMeters, LngLat } from "../../Utils/geo/distance"
import { getIo } from "../../Utils/socket/socket.service"

export type ArrivingDriver = Pick<IUser, "_id" | "firstname" | "lastname" | "phone">

export type PickupProximity =
  | { near: true; distanceMeters: number }
  | { near: false; distanceMeters: number | null } // null: no recent position stored

export const isNearPickup = (position: LngLat, pickup: LngLat): boolean =>
  haversineMeters(position, pickup) <= env.ARRIVAL_RADIUS_METERS

// Uses the driver's last pinged position (expires after ~2 min, so it is never stale).
export const checkDriverNearPickup = async (
  driverId: string,
  pickup: LngLat,
): Promise<PickupProximity> => {
  const position = await getDriverLocation(driverId)
  if (!position) return { near: false, distanceMeters: null }
  const distanceMeters = Math.round(haversineMeters(position, pickup))
  return distanceMeters <= env.ARRIVAL_RADIUS_METERS
    ? { near: true, distanceMeters }
    : { near: false, distanceMeters }
}

const vehicleFor = async (
  rideId: string,
  driverId: string,
): Promise<IVehicle | null> => {
  const cached = await get({ key: `vehicle:${rideId}` })
  if (cached) {
    try {
      return JSON.parse(cached) as IVehicle
    } catch {
      // fall through to the driver record
    }
  }
  const driver = await DriverModel.findOne({ userId: driverId })
    .select("vehicle")
    .lean()
  return driver?.vehicle ?? null
}

// accepted -> arrived, atomically, for both the manual endpoint and automatic arrival.
// Returns null if the ride isn't this driver's or isn't "accepted" any more (e.g. the
// other trigger won, or the ride was cancelled), so it can never fire twice.
export const markArrived = async ({
  rideId,
  driver,
  auto,
}: {
  rideId: string
  driver: ArrivingDriver
  auto: boolean
}) => {
  const ride = await RideModel.findOneAndUpdate(
    { _id: rideId, driverId: driver._id, status: RideStatusEnum.ACCEPTED },
    { $set: { status: RideStatusEnum.ARRIVED, arrivedAt: new Date() } },
    { returnDocument: "after" },
  ).lean()
  if (!ride) return null

  // Side effects: never undo the arrival from here on
  const driverId = driver._id.toString()
  try {
    const [vehicle, position] = await Promise.all([
      vehicleFor(rideId, driverId),
      getDriverLocation(driverId),
      // stop proximity checks: drop the pickup from the active-ride cache
      setDriverActiveRide(driverId, {
        rideId,
        riderId: ride.riderId.toString(),
      }),
    ])
    const currentLocation = position
      ? { lng: position.lng, lat: position.lat }
      : undefined

    const io = getIo()
    io?.to(ride.riderId.toString()).emit("rider:arrived", {
      rideId,
      driver: {
        id: driverId,
        firstname: driver.firstname,
        lastname: driver.lastname,
        phone: driver.phone,
        vehicle,
        currentLocation,
      },
      arrivedAt: ride.arrivedAt,
      auto,
    })
    // the driver app learns about automatic arrivals from this
    io?.to(driverId).emit("ride:arrived", {
      rideId,
      arrivedAt: ride.arrivedAt,
      auto,
    })
    await del({ key: `vehicle:${rideId}` })
  } catch (err) {
    console.error("arrive side effects failed", err)
  }
  return ride
}
