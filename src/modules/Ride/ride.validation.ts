import { z } from "zod"

const rideIdParams = z.strictObject({
  id: z.string({ error: "Ride id is required" }).regex(/^[0-9a-fA-F]{24}$/, {
    error: "Invalid ride id",
  }),
})

const longitude = z
  .number({ error: "Longitude must be a number" })
  .min(-180, { error: "Longitude must be between -180 and 180" })
  .max(180, { error: "Longitude must be between -180 and 180" })

const latitude = z
  .number({ error: "Latitude must be a number" })
  .min(-90, { error: "Latitude must be between -90 and 90" })
  .max(90, { error: "Latitude must be between -90 and 90" })

// Accepts { lng | longitude | lon, lat | latitude } and normalizes to { lng, lat }.
const location = (label: string) =>
  z.preprocess(
    (input) => {
      if (typeof input !== "object" || input === null) return input
      const { lng, longitude, lon, lat, latitude } = input as Record<
        string,
        unknown
      >
      return { lng: lng ?? longitude ?? lon, lat: lat ?? latitude }
    },
    z.strictObject(
      { lng: longitude, lat: latitude },
      { error: `${label} must be an object with lng and lat` },
    ),
  )

// Query strings arrive as text, so coerce before range-checking.
const queryCoordinate = (schema: typeof longitude, label: string) =>
  z.coerce.number({ error: `${label} must be a number` }).pipe(schema)

export const estimateRideSchema = {
  query: z.strictObject({
    originlng: queryCoordinate(longitude, "originlng"),
    originlat: queryCoordinate(latitude, "originlat"),
    destinationlng: queryCoordinate(longitude, "destinationlng"),
    destinationlat: queryCoordinate(latitude, "destinationlat"),
  }),
}

export const requestRideSchema = {
  body: z.strictObject({
    pickup: location("Pickup"),
    dropoff: location("Dropoff"),
  }),
}

export const rideHistorySchema = {
  query: z.strictObject({
    page: z.coerce
      .number({ error: "Page must be a number" })
      .int({ error: "Page must be an integer" })
      .min(1, { error: "Page must be at least 1" })
      .default(1),
    limit: z.coerce
      .number({ error: "Limit must be a number" })
      .int({ error: "Limit must be an integer" })
      .min(1, { error: "Limit must be at least 1" })
      .max(50, { error: "Limit must be at most 50" })
      .default(10),
  }),
}

export const getRideSchema = {
  params: rideIdParams,
}

export const acceptRideSchema = {
  params: rideIdParams,
}

export const arriveRideSchema = {
  params: rideIdParams,
}

export const startRideSchema = {
  params: rideIdParams,
}

export const completeRideSchema = {
  params: rideIdParams,
}

export const cancelRideSchema = {
  params: rideIdParams,
  // Express 5 leaves req.body undefined when no body is sent; reason is optional anyway.
  body: z
    .strictObject({
      reason: z
        .string({ error: "Reason must be a string" })
        .trim()
        .max(200, { error: "Reason must be at most 200 characters" })
        .optional(),
    })
    .default({}),
}
