import { HydratedDocument, Model, model, Schema, Types } from "mongoose"
import { IPoint } from "./user.model"

export interface IVehicle {
  brand: string
  model: string
  year: number
  color: string
  plateNumber: string
}

export interface IDriver {
  userId: Types.ObjectId
  licenseNumber: string
  licenseImage: string
  nationalIdImage: string
  vehicle: IVehicle
  isOnline: boolean
  isAvailable: boolean
  currentLocation?: IPoint
  lastLocationUpdate?: Date
  ratingAverage?: Number
  ratingCount: Number
  earningsBalance: Number
}

const vehicleSchema = new Schema<IVehicle>(
  {
    brand: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    year: { type: Number, required: true, min: 1990 },
    color: { type: String, required: true, trim: true },
    plateNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
  },
  { _id: false },
)

export const driverSchema = new Schema<IDriver>(
  {
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    licenseNumber: { type: String, required: true, unique: true, trim: true },
    licenseImage: { type: String, required: true },
    nationalIdImage: { type: String, required: true },
    vehicle: { type: vehicleSchema, required: true },

    isOnline: { type: Boolean, default: false },
    isAvailable: { type: Boolean, default: false },

    // Last known location (live tracking should live in Redis; this is a fallback/snapshot)
    // currentLocation: { type: pointSchema },
    // lastLocationUpdate: { type: Date },

    earningsBalance: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)

export const DriverModel: Model<IDriver> = model<IDriver>(
  "Driver",
  driverSchema,
)

export type HDriverDocument = HydratedDocument<IDriver>
