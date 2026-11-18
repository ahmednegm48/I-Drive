import { resolve } from "path"
import { config } from "dotenv"

config({ path: resolve("./config/dev.env") })

export const env = {
  PORT: Number(process.env.PORT) || 3000,
  MODE: process.env.MODE as string,
  APPLICATION_NAME: process.env.APPLICATION_NAME || "I-Drive",
  DB_URI: process.env.DB_URI as string,
  SALT: Number(process.env.SALT),
  ENC_KEY: process.env.ENC_KEY as string,
  TOKEN_USER_SECRET: process.env.TOKEN_USER_SECRET as string,
  REFRESH_TOKEN_USER_SECRET: process.env.REFRESH_TOKEN_USER_SECRET as string,
  TOKEN_USER_EXPIRATION: Number(process.env.TOKEN_USER_EXPIRATION),
  REFRESH_TOKEN_USER_EXPIRATION: Number(
    process.env.REFRESH_TOKEN_USER_EXPIRATION,
  ),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID as string,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET as string,
  REDIS_URL: process.env.REDIS_URL as string,
  WHITE_LIST: process.env.WHITE_LIST as string,
  EMAIL: process.env.EMAIL as string,
  PASSWORD: process.env.PASSWORD as string,
  MAPBOX: process.env.MAPBOX as string,
  // Rider cancellation fee (EGP). Disabled unless explicitly enabled.
  CANCELLATION_FEE_ENABLED: process.env.CANCELLATION_FEE_ENABLED === "true",
  CANCELLATION_FEE_ACCEPTED: Number(process.env.CANCELLATION_FEE_ACCEPTED) || 0,
  CANCELLATION_FEE_ARRIVED: Number(process.env.CANCELLATION_FEE_ARRIVED) || 0,
  // How close (meters) the driver must be to the pickup to arrive, automatically or manually.
  ARRIVAL_RADIUS_METERS: Number(process.env.ARRIVAL_RADIUS_METERS) || 100,
}

// Fail at startup instead of when the first token is signed.
for (const key of ["TOKEN_USER_SECRET", "REFRESH_TOKEN_USER_SECRET"] as const) {
  if (!env[key]) throw new Error(`Missing required env var ${key}`)
}
for (const key of [
  "TOKEN_USER_EXPIRATION",
  "REFRESH_TOKEN_USER_EXPIRATION",
] as const) {
  if (!(env[key] > 0))
    throw new Error(`${key} must be a positive number of seconds`)
}

export type Env = typeof env
