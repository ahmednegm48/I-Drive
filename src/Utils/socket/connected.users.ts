import { DriverModel } from "../../DB/models/driver.model";
import { RideModel } from "../../DB/models/ride.model";
import { redisClient } from "../../DB/redis/redis.connection";
import {
  clearDriverActiveRide,
  geoDel,
  geoSet,
  setDriverActiveRide,
  setDriverLocation,
  statusGet,
} from "../../DB/redis/redis.service";
import { RideStatusEnum } from "../enums/user.enum";

export interface GeoPoint {
  lng: number;
  lat: number;
}

// A driver with a ride in one of these is on a trip.
export const DRIVER_BUSY_STATUSES = [
  RideStatusEnum.ACCEPTED,
  RideStatusEnum.ARRIVED,
  RideStatusEnum.STARTED,
];

const toNumber = (value: unknown): number =>
  typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : NaN;

// Accepts numbers or numeric strings; null when missing or outside Redis GEO limits.
export const parseLocation = (input: unknown): GeoPoint | null => {
  if (typeof input !== "object" || input === null) return null;
  const { lng, lat } = input as Record<string, unknown>;
  const longitude = toNumber(lng);
  const latitude = toNumber(lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > 85.05112878)
    return null;
  return { lng: longitude, lat: latitude };
};

// Optional compass heading; dropped when missing or outside 0–360.
export const parseHeading = (input: unknown): number | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const heading = toNumber((input as Record<string, unknown>).heading);
  return Number.isFinite(heading) && heading >= 0 && heading <= 360
    ? heading
    : undefined;
};

// Optional GPS accuracy in meters; dropped when missing or not a positive number.
export const parseAccuracy = (input: unknown): number | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const accuracy = toNumber((input as Record<string, unknown>).accuracy);
  return Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : undefined;
};

// Driver went online (connected with a location). Always rewrites position and online flag,
// so state left over from a crash gets corrected. Availability is only restored when the
// driver isn't mid-ride, and the active-ride cache is re-seeded either way.
export const addConnection = async (
  userId: string,
  location: GeoPoint,
): Promise<void> => {
  await geoSet({ userId, lng: location.lng, lat: location.lat });
  // The handshake position is a real fix: count it as the latest position too.
  await setDriverLocation(userId, {
    lng: location.lng,
    lat: location.lat,
    updatedAt: new Date().toISOString(),
  });
  const activeRide = await RideModel.findOne({
    driverId: userId,
    status: { $in: DRIVER_BUSY_STATUSES },
  })
    .select("_id riderId status pickup")
    .lean();
  if (activeRide) {
    await setDriverActiveRide(userId, {
      rideId: activeRide._id.toString(),
      riderId: activeRide.riderId.toString(),
      // still heading to the pickup: keep automatic arrival armed
      ...(activeRide.status === RideStatusEnum.ACCEPTED && {
        pickup: {
          lng: activeRide.pickup.coordinates[0],
          lat: activeRide.pickup.coordinates[1],
        },
      }),
    });
  } else {
    await clearDriverActiveRide(userId);
  }
  await DriverModel.updateOne(
    { userId },
    { $set: { isOnline: true, ...(!activeRide && { isAvailable: true }) } },
  );
};

// Driver's last socket closed: take them off the dispatch map. isAvailable is left as is.
export const removeConnection = async (userId: string): Promise<void> => {
  await geoDel({ userId });
  await DriverModel.updateOne({ userId }, { $set: { isOnline: false } });
};

// Run once at startup: sockets from before a restart are gone, so nobody is online yet.
// With several app instances this would also clear the other instances' drivers.
export const resetOnlineDrivers = async (): Promise<void> => {
  try {
    await redisClient.del("online:users");
    await DriverModel.updateMany(
      { isOnline: true },
      { $set: { isOnline: false } },
    );
  } catch (err) {
    console.error("[socket] resetting online drivers failed", err);
  }
};

export const isUserOnline = async (userId: string): Promise<boolean> => {
  const socket = await statusGet({ userId });
  if (!socket) return false;
  return true;
};
