import { z } from "zod"
import {
  cancelRideSchema,
  estimateRideSchema,
  rideHistorySchema,
  requestRideSchema,
  startRideSchema,
} from "./ride.validation"

export type IEstimateRideDTO = z.infer<typeof estimateRideSchema.query>
export type IRequestRideDTO = z.infer<typeof requestRideSchema.body>
export type IRideHistoryDTO = z.infer<typeof rideHistorySchema.query>
export type IRideParamsDTO = z.infer<typeof startRideSchema.params>
export type ICancelRideDTO = z.infer<typeof cancelRideSchema.body>
