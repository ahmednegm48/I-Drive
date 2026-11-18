import axios from "axios";
import { Request, Response } from "express";
import { env } from "../../config/config.service";
import { IRide, RideModel } from "../../DB/models/ride.model";
import { IPoint, IUser } from "../../DB/models/user.model";
import { checkDriverNearPickup, markArrived } from "./ride.arrival";
import { DriverModel } from "../../DB/models/driver.model";
import { redisClient } from "../../DB/redis/redis.connection";
import { getIo } from "../../Utils/socket/socket.service";
import { QueryFilter, Types } from "mongoose";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from "../../Utils/response/error.response";
import {
  CancelledByEnum,
  RideStatusEnum,
  RoleEnum,
} from "../../Utils/enums/user.enum";
import {
  clearDriverActiveRide,
  del,
  geoGet,
  get,
  getDriverLocation,
  set,
  setDriverActiveRide,
} from "../../DB/redis/redis.service";
import { DRIVER_BUSY_STATUSES } from "../../Utils/socket/connected.users";
import {
  ICancelRideDTO,
  IEstimateRideDTO,
  IRequestRideDTO,
  IRideHistoryDTO,
  IRideParamsDTO,
} from "./ride.dto";
import {
  expireStaleRideRequests,
  OFFERS_TTL_SECONDS,
  offersKey,
  REQUEST_TTL_SECONDS,
  requestCutoff,
  withdrawOffers,
} from "./ride.expiry";

const ACTIVE_RIDE_STATUSES = [
  RideStatusEnum.REQUESTED,
  RideStatusEnum.ACCEPTED,
  RideStatusEnum.ARRIVED,
  RideStatusEnum.STARTED,
];

const NEARBY_RADIUS_KM = 5;
const NEARBY_MAX_DRIVERS = 20;

const calculateFare = (
  distanceMeters: number,
  durationSeconds: number,
): number => {
  const distanceByKm = distanceMeters / 1000;
  const durationByMin = durationSeconds / 60;
  return Number((20 + distanceByKm * 5 + durationByMin * 0.5).toFixed(2));
};

const CANCELLABLE_RIDE_STATUSES = [
  RideStatusEnum.REQUESTED,
  RideStatusEnum.ACCEPTED,
  RideStatusEnum.ARRIVED,
];

// Fee is charged only to the rider, only after a driver accepted, and only when enabled.
const cancellationFeeFor = (
  cancelledBy: CancelledByEnum,
  status: RideStatusEnum,
): number => {
  if (!env.CANCELLATION_FEE_ENABLED || cancelledBy !== CancelledByEnum.RIDER)
    return 0;
  if (status === RideStatusEnum.ACCEPTED) return env.CANCELLATION_FEE_ACCEPTED;
  if (status === RideStatusEnum.ARRIVED) return env.CANCELLATION_FEE_ARRIVED;
  return 0;
};

// Same rule as cancellationFeeFor, evaluated against the ride's status inside the atomic update.
const cancellationFeeExpression = (cancelledBy: CancelledByEnum) => ({
  $switch: {
    branches: [RideStatusEnum.ACCEPTED, RideStatusEnum.ARRIVED].map(
      (status) => ({
        case: { $eq: ["$status", status] },
        then: cancellationFeeFor(cancelledBy, status),
      }),
    ),
    default: 0,
  },
});

// An atomic transition matched nothing: re-fetch to pick 404, 403 or 409.
const throwTransitionError = async ({
  rideId,
  userId,
  allowRider,
  action,
}: {
  rideId: string;
  userId: Types.ObjectId;
  allowRider: boolean;
  action: string;
}): Promise<never> => {
  const ride = await RideModel.findById(rideId)
    .select("riderId driverId status")
    .lean();
  if (!ride) throw new NotFoundException("Ride not found");

  const isDriver = ride.driverId?.equals(userId) ?? false;
  const isRider = allowRider && ride.riderId.equals(userId);
  if (!isDriver && !isRider)
    throw new ForbiddenException(`You are not allowed to ${action} this ride`);

  throw new ConflictException(`Cannot ${action} a ride that is ${ride.status}`);
};

const pointToLngLat = (point: IPoint): { lng: number; lat: number } => ({
  lng: point.coordinates[0],
  lat: point.coordinates[1],
});

type RideParticipant =Pick<IUser, "_id" | "firstname" | "lastname" | "phone">;

// One ride with both parties' contact info, the driver's vehicle and, while it is
// still being offered, how many seconds are left before it expires.
const findRideDetails = async (filter: QueryFilter<IRide>) => {
  const ride = await RideModel.findOne(filter)
    .sort({ createdAt: -1 })
    .populate<{
      riderId: RideParticipant | null;
      driverId?: RideParticipant | null;
    }>([
      { path: "riderId", select: "firstname lastname phone" },
      { path: "driverId", select: "firstname lastname phone" },
    ])
    .lean();
  if (!ride) return null;

  const vehicle = ride.driverId
    ? ((
        await DriverModel.findOne({ userId: ride.driverId._id })
          .select("vehicle")
          .lean()
      )?.vehicle ?? null)
    : null;
  const expiresIn =
    ride.status === RideStatusEnum.REQUESTED && ride.createdAt
      ? Math.max(
          0,
          Math.ceil(
            (ride.createdAt.getTime() +
              REQUEST_TTL_SECONDS * 1000 -
              Date.now()) /
              1000,
          ),
        )
      : null;
  // Last pinged position, only while the driver is actually on this ride.
  const driverLocation =
    ride.driverId && DRIVER_BUSY_STATUSES.includes(ride.status as RideStatusEnum)
      ? await getDriverLocation(ride.driverId._id.toString())
      : null;
  return { ...ride, vehicle, expiresIn, driverLocation };
};

const freeDriver = async (driverUserId: Types.ObjectId): Promise<void> => {
  try {
    await DriverModel.updateOne(
      { userId: driverUserId },
      { $set: { isAvailable: true } },
    );
  } catch (err) {
    console.error("freeing driver failed", err);
  }
};

class RideService {
  estimate = async (req: Request, res: Response): Promise<Response> => {
    const { originlng, originlat, destinationlng, destinationlat } =
      req.query as unknown as IEstimateRideDTO;
    const coords = `${originlng},${originlat};${destinationlng},${destinationlat}`;
    const { data } = await axios.get(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}`,
      {
        params: {
          overview: "false",
          access_token: env.MAPBOX,
        },
        timeout: 5000,
      },
    );
    if (data.code !== "Ok" || !data.routes?.[0]) {
      throw new Error(
        `Mapbox error: ${data.code} - ${data.message || "no route found"}`,
      );
    }

    const distance: number = data.routes[0].distance; // meters
    const duration: number = data.routes[0].duration; // seconds
    const estimateFare: number = calculateFare(distance, duration);

    await set({
      key: `estimate:${req.user!._id}`,
      value: `${distance}:${duration}:${estimateFare}`,
      ttl: 300,
    });

    return res.status(200).json({
      message: "Estimate calculated successfully",
      data: { distance, duration, estimateFare },
    });
  };

  request = async (req: Request, res: Response): Promise<Response> => {
    const riderId = req.user!._id;
    const { pickup: origin, dropoff: destination }: IRequestRideDTO = req.body;

    const redisRecord = (await get({ key: `estimate:${riderId}` })) as string;
    if (!redisRecord)
      throw new BadRequestException("Invalid Flow: Call estimate first");
    const [estimatedDistance, estimatedDuration, estimatedFare] =
      redisRecord.split(":");

    // Don't let an overdue request the sweeper hasn't reached yet block this rider.
    await expireStaleRideRequests({ riderId });

    const existingRide = await RideModel.findOne({
      riderId,
      status: { $in: ACTIVE_RIDE_STATUSES },
    })
      .select("_id status")
      .lean();
    if (existingRide) {
      throw new ConflictException(
        "You already have an active ride. Complete or cancel it first.",
      );
    }

    const ride = await RideModel.create({
      riderId,
      pickup: {
        type: "Point",
        coordinates: [origin.lng, origin.lat],
      },
      dropoff: {
        type: "Point",
        coordinates: [destination.lng, destination.lat],
      },
      status: RideStatusEnum.REQUESTED,
      estimatedDistance: Number(estimatedDistance),
      estimatedDuration: Number(estimatedDuration),
      estimatedFare: Number(estimatedFare),
    });

    const rideId = ride._id.toString();

    // Cache the request payload for accept/expire flows (TTL = request window).
    await redisClient.set(
      `ride:request:${rideId}`,
      JSON.stringify({
        rideId,
        riderId: riderId.toString(),
        pickup: ride.pickup,
        dropoff: ride.dropoff,
      }),
      { EX: REQUEST_TTL_SECONDS },
    );

    // Find nearby online drivers (Redis GEO index, same key as socket tracking).
    let nearbyDriverIds: string[] = [];
    try {
      nearbyDriverIds = (await redisClient.geoSearch(
        "online:users",
        { longitude: origin.lng, latitude: origin.lat },
        { radius: NEARBY_RADIUS_KM, unit: "km" },
        { COUNT: NEARBY_MAX_DRIVERS, SORT: "ASC" },
      )) as string[];
    } catch (error) {
      console.error("Ride request: geoSearch failed", error);
    }

    const availableDrivers = nearbyDriverIds.length
      ? await DriverModel.find({
          userId: {
            $in: nearbyDriverIds, //.filter((id) => id !== riderId.toString()),
          },
          isOnline: true,
          isAvailable: true,
        })
          .select("userId")
          .lean()
      : [];

    const io = getIo();
    const payload = {
      rideId,
      riderId: riderId.toString(),
      pickup: ride.pickup,
      dropoff: ride.dropoff,
      estimatedDistance,
      estimatedDuration,
      estimatedFare,
      expiresIn: REQUEST_TTL_SECONDS,
    };

    if (io && availableDrivers.length) {
      for (const driver of availableDrivers) {
        io.to(driver.userId.toString()).emit("ride:requested", payload);
      }
      // Remember who saw the offer so expiry can withdraw it from them.
      try {
        const key = offersKey(rideId);
        await redisClient.sAdd(
          key,
          availableDrivers.map((driver) => driver.userId.toString()),
        );
        await redisClient.expire(key, OFFERS_TTL_SECONDS);
      } catch (error) {
        console.error("Ride request: storing offered drivers failed", error);
      }
    }

    return res.status(201).json({
      message: "Ride requested successfully",
      data: {
        ride,
        expiresIn: REQUEST_TTL_SECONDS,
      },
    });
  };

  accept = async (req: Request, res: Response): Promise<Response> => {
  const driverUserId = req.user!._id;
  const { id: rideId } = req.params as IRideParamsDTO;

  // 1. Claim the driver atomically
  const driver = await DriverModel.findOneAndUpdate(
    { userId: driverUserId, isAvailable: true },
    { $set: { isAvailable: false } },
    { returnDocument: "before" },
  ).lean();
  if (!driver) throw new ConflictException("Driver not available");

  // 2. Claim the ride atomically (self-accept and overdue requests blocked in the filter)
  const claimedRide = await RideModel.findOneAndUpdate(
    {
      _id: rideId,
      status: RideStatusEnum.REQUESTED,
      riderId: { $ne: driverUserId },
      createdAt: { $gt: requestCutoff() },
    },
    {
      $set: {
        driverId: driverUserId,
        status: RideStatusEnum.ACCEPTED,
        acceptedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  )
    .populate("driverId", "firstname lastname phone")
    .lean();

  if (!claimedRide) {
    // free the driver again
    await DriverModel.updateOne(
      { userId: driverUserId },
      { $set: { isAvailable: true } },
    );
    const existing = await RideModel.findById(rideId).select("_id").lean();
    if (!existing) throw new NotFoundException("Ride not found");
    throw new ConflictException("Ride is no longer available");
  }

  // 3. Side effects: never fail the request from here on
  try {
    await Promise.all([
      del({ key: `ride:request:${rideId}` }),
      set({ key: `vehicle:${rideId}`, value: driver.vehicle, ttl: 3600 }),
      // lets driver:location pings reach this rider without a DB lookup
      setDriverActiveRide(driverUserId.toString(), {
        rideId,
        riderId: claimedRide.riderId.toString(),
        pickup: pointToLngLat(claimedRide.pickup),
      }),
      withdrawOffers(rideId, "taken", driverUserId.toString()),
    ]);

    const point = (await geoGet({ userId: driverUserId.toString() }))?.[0];
    const currentLocation = point
      ? { lng: Number(point.longitude), lat: Number(point.latitude) }
      : undefined;

    const d = claimedRide.driverId as any; // populated
    getIo()?.to(claimedRide.riderId.toString()).emit("ride:accepted", {
      rideId,
      driver: {
        id: driverUserId.toString(),
        firstname: d.firstname,
        lastname: d.lastname,
        phone: d.phone,
        vehicle: driver.vehicle,
        currentLocation,
      },
      acceptedAt: claimedRide.acceptedAt,
    });
  } catch (err) {
    console.error("accept side effects failed", err);
  }

  return res
    .status(200)
    .json({ message: "Ride accepted successfully", data: { ride: claimedRide } });
};

  history = async (req: Request, res: Response): Promise<Response> => {
    const user = req.user!;
    const { page, limit } = req.query as unknown as IRideHistoryDTO;

    const ownerField = user.role === RoleEnum.RIDER ? "riderId" : "driverId";
    const filter = {
      [ownerField]: user._id,
      status: { $in: [RideStatusEnum.COMPLETED, RideStatusEnum.CANCELLED] },
    };

    const [ridesHistory, total] = await Promise.all([
      RideModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      RideModel.countDocuments(filter),
    ]);

    return res.status(200).json({
      message: "Ride history retrieved successfully",
      data: { ridesHistory, page, limit, total },
    });
  };

  // The caller's in-progress ride (as rider or as driver), or null. Lets clients recover after a restart.
  active = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!._id;

    // An overdue request the sweeper hasn't reached yet is not active.
    await expireStaleRideRequests({ riderId: userId });

    const ride = await findRideDetails({
      $or: [{ riderId: userId }, { driverId: userId }],
      status: { $in: ACTIVE_RIDE_STATUSES },
    });

    return res.status(200).json({
      message: ride ? "Active ride retrieved successfully" : "No active ride",
      data: { ride },
    });
  };

  getById = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!._id;
    const { id: rideId } = req.params as IRideParamsDTO;

    const ride = await findRideDetails({ _id: rideId });
    if (!ride) throw new NotFoundException("Ride not found");

    const isRider = ride.riderId?._id.equals(userId) ?? false;
    const isDriver = ride.driverId?._id.equals(userId) ?? false;
    if (!isRider && !isDriver)
      throw new ForbiddenException("You are not allowed to view this ride");

    return res
      .status(200)
      .json({ message: "Ride retrieved successfully", data: { ride } });
  };

  // Manual arrival. Allowed only when the driver's last pinged position is near the pickup;
  // the same transition also happens automatically from driver:location pings.
  arrive = async (req: Request, res: Response): Promise<Response> => {
    const { id: rideId } = req.params as IRideParamsDTO;
    const driver = req.user!;
    const driverId = driver._id;

    // Pickup is immutable; the status guard is the atomic update in markArrived.
    const accepted = await RideModel.findOne({
      _id: rideId,
      driverId,
      status: RideStatusEnum.ACCEPTED,
    })
      .select("pickup")
      .lean();
    if (!accepted)
      return throwTransitionError({
        rideId,
        userId: driverId,
        allowRider: false,
        action: "arrive at",
      });

    const proximity = await checkDriverNearPickup(
      driverId.toString(),
      pointToLngLat(accepted.pickup),
    );
    // 422, not 409: the ride is fine, the driver just isn't there yet (409 means "ride changed").
    if (!proximity.near) {
      const unknown = proximity.distanceMeters === null;
      throw new UnprocessableEntityException(
        unknown
          ? "Your current location is unknown. Turn on location sharing and try again."
          : `You are ${proximity.distanceMeters} m from the pickup point. Get within ${env.ARRIVAL_RADIUS_METERS} m to confirm arrival.`,
        {
          cause: {
            code: unknown ? "DRIVER_LOCATION_UNKNOWN" : "DRIVER_NOT_NEAR_PICKUP",
            distanceMeters: proximity.distanceMeters,
            radiusMeters: env.ARRIVAL_RADIUS_METERS,
          },
        },
      );
    }

    const ride = await markArrived({ rideId, driver, auto: false });
    if (!ride)
      return throwTransitionError({
        rideId,
        userId: driverId,
        allowRider: false,
        action: "arrive at",
      });

    return res
      .status(200)
      .json({ message: "Arrival confirmed", data: { ride } });
  };

  start = async (req: Request, res: Response): Promise<Response> => {
    const driverId = req.user!._id;
    const { id: rideId } = req.params as IRideParamsDTO;

    const ride = await RideModel.findOneAndUpdate(
      { _id: rideId, driverId, status: RideStatusEnum.ARRIVED },
      { $set: { status: RideStatusEnum.STARTED, startedAt: new Date() } },
      { returnDocument: "after" },
    ).lean();
    if (!ride)
      return throwTransitionError({
        rideId,
        userId: driverId,
        allowRider: false,
        action: "start",
      });

    try {
      getIo()?.to(ride.riderId.toString()).emit("ride:started", {
        rideId,
        status: ride.status,
        startedAt: ride.startedAt,
      });
    } catch (err) {
      console.error("start side effects failed", err);
    }

    return res
      .status(200)
      .json({ message: "Ride started successfully", data: { ride } });
  };

  complete = async (req: Request, res: Response): Promise<Response> => {
    const driverId = req.user!._id;
    const { id: rideId } = req.params as IRideParamsDTO;

    // Read fare inputs only; the status guard is the atomic filter below.
    const started = await RideModel.findOne({
      _id: rideId,
      driverId,
      status: RideStatusEnum.STARTED,
    })
      .select("startedAt estimatedDistance")
      .lean();
    if (!started?.startedAt)
      return throwTransitionError({
        rideId,
        userId: driverId,
        allowRider: false,
        action: "complete",
      });

    const completedAt = new Date();
    const duration = Math.max(
      0,
      Math.round((completedAt.getTime() - started.startedAt.getTime()) / 1000),
    ); // seconds
    // No per-ride location trail is stored, so fall back to the route estimate.
    const distance = started.estimatedDistance; // meters
    const finalFare = calculateFare(distance, duration);

    const ride = await RideModel.findOneAndUpdate(
      { _id: rideId, driverId, status: RideStatusEnum.STARTED },
      {
        $set: {
          status: RideStatusEnum.COMPLETED,
          completedAt,
          distance,
          duration,
          finalFare,
        },
      },
      { returnDocument: "after" },
    ).lean();
    if (!ride)
      return throwTransitionError({
        rideId,
        userId: driverId,
        allowRider: false,
        action: "complete",
      });

    // Free the driver and credit the fare in one write. The atomic status
    // guard above ensures this runs once per ride.
    try {
      await DriverModel.updateOne(
        { userId: driverId },
        { $set: { isAvailable: true }, $inc: { earningsBalance: finalFare } },
      );
    } catch (err) {
      console.error("crediting driver earnings failed", err);
    }
    await clearDriverActiveRide(driverId.toString());
    try {
      getIo()?.to(ride.riderId.toString()).emit("ride:completed", {
        rideId,
        distance,
        duration,
        finalFare,
        currency: "EGP",
        completedAt,
      });
    } catch (err) {
      console.error("complete side effects failed", err);
    }

    return res
      .status(200)
      .json({ message: "Ride completed successfully", data: { ride } });
  };

  cancel = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!._id;
    const { id: rideId } = req.params as IRideParamsDTO;
    const { reason }: ICancelRideDTO = req.body;
    const cancelReason = reason || undefined; // already trimmed; blank means none

    // riderId never changes and driverId is set once, so this decides who the caller is.
    const participants = await RideModel.findById(rideId)
      .select("riderId driverId")
      .lean();
    if (!participants) throw new NotFoundException("Ride not found");
    const cancelledBy = participants.riderId.equals(userId)
      ? CancelledByEnum.RIDER
      : participants.driverId?.equals(userId)
        ? CancelledByEnum.DRIVER
        : undefined;
    if (!cancelledBy)
      throw new ForbiddenException("You are not allowed to cancel this ride");

    // Pipeline update so the fee is decided from the status at the moment of cancelling.
    const cancelledAt = new Date();
    const ride = await RideModel.findOneAndUpdate(
      {
        _id: rideId,
        status: { $in: CANCELLABLE_RIDE_STATUSES },
        ...(cancelledBy === CancelledByEnum.RIDER
          ? { riderId: userId }
          : { driverId: userId }),
      },
      [
        {
          $set: {
            status: RideStatusEnum.CANCELLED,
            cancelledBy,
            cancelledAt,
            cancellationFee: cancellationFeeExpression(cancelledBy),
            ...(cancelReason !== undefined && {
              cancelReason: { $literal: cancelReason },
            }),
          },
        },
      ],
      { returnDocument: "after", updatePipeline: true },
    ).lean();
    if (!ride)
      return throwTransitionError({
        rideId,
        userId,
        allowRider: true,
        action: "cancel",
      });

    // accept always sets driverId, so no driver means the ride was still "requested".
    if (ride.driverId) {
      await freeDriver(ride.driverId);
      await clearDriverActiveRide(ride.driverId.toString());
    } else {
      await del({ key: `ride:request:${rideId}` });
      await withdrawOffers(rideId, "cancelled");
    }

    const notifyUserId =
      cancelledBy === CancelledByEnum.RIDER ? ride.driverId : ride.riderId;
    try {
      if (notifyUserId) {
        getIo()?.to(notifyUserId.toString()).emit("ride:cancelled", {
          rideId,
          cancelledBy,
          cancelReason: ride.cancelReason,
          cancelledAt,
        });
      }
    } catch (err) {
      console.error("cancel side effects failed", err);
    }

    return res
      .status(200)
      .json({ message: "Ride cancelled successfully", data: { ride } });
  };
}

export default new RideService();
