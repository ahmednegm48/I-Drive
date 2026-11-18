import { HydratedDocument, Model, model, Schema, Types } from "mongoose";
import {
  GenderEnum,
  ProviderEnum,
  RoleEnum,
} from "../../Utils/enums/user.enum";
import { generateHash } from "../../Utils/security/hash";

export interface IPoint {
  type: "Point";
  coordinates: [number, number];
}

interface ISavedPlace {
  label: string;
  name?: string;
  address: string;
  location: IPoint;
}

export interface IUser {
  _id: Types.ObjectId;
  firstname: string;
  lastname: string;
  username?: string;
  email: string;
  confirmedAt?: Date;
  password?: string;
  phone: string;
  currentLocation?:IPoint;
  savedPlaces: ISavedPlace[];
  gender: GenderEnum;
  provider: ProviderEnum;
  role: RoleEnum;
  profilePicture: string;
  changeCredentialsTime?: Date;
  createdAt: Date;
  updatedAt?: Date;
}

export const pointSchema = new Schema<IPoint>(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

const savedPlaceSchema = new Schema<ISavedPlace>({
  label: { type: String, enum: ["home", "work", "other"], required: true },
  name: { type: String, trim: true },
  address: { type: String, required: true },
  location: { type: pointSchema, required: true },
});

export const UserSchema = new Schema<IUser>(
  {
    firstname: { type: String, required: true, minLength: 2, maxLength: 25 },
    lastname: { type: String, required: true, minLength: 2, maxLength: 25 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    confirmedAt: Date,
    password: {
      type: String,
      required: function (): boolean {
        return this.provider === ProviderEnum.SYSTEM;
      },
    },
    phone: String,
    savedPlaces: {
      type: [savedPlaceSchema],
      default: [],
    },
    gender: {
      type: String,
      enum: Object.values(GenderEnum),
      default: GenderEnum.MALE,
    },
    provider: {
      type: String,
      enum: Object.values(ProviderEnum),
      default: ProviderEnum.SYSTEM,
    },
    role: {
      type: String,
      enum: Object.values(RoleEnum),
      default: RoleEnum.RIDER,
    },
    profilePicture:String,
    changeCredentialsTime: Date,
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.password;
        return ret;
      },
    },
  },
);

UserSchema.pre(
  "save",
  async function (this: HUserDocument) {
    if (this.password && this.isModified("password")) {
      this.password = await generateHash(this.password);
      if (!this.isNew) this.changeCredentialsTime = new Date();
    }
  },
);

export const UserModel: Model<IUser> = model<IUser>("User", UserSchema);

export type HUserDocument = HydratedDocument<IUser>;
