import { HydratedDocument, Model, model, Schema, Types } from "mongoose"
import { CancelledByEnum, RideStatusEnum } from "../../Utils/enums/user.enum"
import { IPoint, pointSchema } from "./user.model"

export interface IRide {
  riderId: Types.ObjectId
  driverId?: Types.ObjectId
  pickup: IPoint
  dropoff: IPoint
  status: string
  estimatedDistance: number
  estimatedDuration: number
  estimatedFare: number
  distance: number
  duration: number
  finalFare: number
  cancelledBy: CancelledByEnum
  cancelReason?: string
  cancellationFee: number
  acceptedAt: Date
  arrivedAt: Date
  startedAt: Date
  completedAt: Date
  cancelledAt: Date
  createdAt?: Date
  updatedAt?: Date
}

const rideSchema = new Schema<IRide>(
  {
    riderId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    driverId: { type: Types.ObjectId, ref: "User", index: true },

    pickup: { type: pointSchema, required: true },
    dropoff: { type: pointSchema, required: true },

    status: {
      type: String,
      enum: Object.values(RideStatusEnum),
      default: RideStatusEnum.REQUESTED,
      index: true,
    },

    // Estimates at request time
    estimatedDistance: { type: Number, required: true }, // meters
    estimatedDuration: { type: Number, required: true }, // seconds
    estimatedFare: { type: Number, required: true },

    // Actuals at completion
    distance: { type: Number },
    duration: { type: Number },
    finalFare: { type: Number },

    cancelledBy: { type: String, enum: Object.values(CancelledByEnum) },
    cancelReason: { type: String, trim: true },
    cancellationFee: { type: Number, default: 0 },

    acceptedAt: Date,
    arrivedAt: Date,
    startedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true },
)

rideSchema.index({ riderId: 1, createdAt: -1 })
rideSchema.index({ driverId: 1, createdAt: -1 })

export const rideTransitions: Record<RideStatusEnum, RideStatusEnum[]> = {
  [RideStatusEnum.REQUESTED]: [
    RideStatusEnum.ACCEPTED,
    RideStatusEnum.CANCELLED,
    RideStatusEnum.EXPIRED,
  ],
  [RideStatusEnum.ACCEPTED]: [RideStatusEnum.ARRIVED, RideStatusEnum.CANCELLED],
  [RideStatusEnum.ARRIVED]: [RideStatusEnum.STARTED, RideStatusEnum.CANCELLED],
  [RideStatusEnum.STARTED]: [RideStatusEnum.COMPLETED],
  [RideStatusEnum.COMPLETED]: [],
  [RideStatusEnum.CANCELLED]: [],
  [RideStatusEnum.EXPIRED]: [],
}

export const RideModel: Model<IRide> = model<IRide>("Ride", rideSchema)

export type HDriverDocument = HydratedDocument<IRide>
