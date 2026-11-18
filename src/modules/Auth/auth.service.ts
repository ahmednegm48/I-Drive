import { Request, Response } from "express";
import { UserModel } from "../../DB/models/user.model";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from "../../Utils/response/error.response";
import { generateOTP } from "../../Utils/security/generateOTP";
import { compareHash, generateHash } from "../../Utils/security/hash";
import {
  IConfirmEmailDTO,
  IForgetPasswordDTO,
  IGoogleLoginDTO,
  ILoginDTO,
  IResetPasswordDTO,
  ISignupDTO,
} from "./auth.dto";
import { del, get, revokeTokenKey, set } from "../../DB/redis/redis.service";
import { OAuth2Client } from "google-auth-library";
import { emailEvents } from "../../Utils/events/email.events";
import {
  createLoginCredentials,
  refreshLoginCredentials,
} from "../../Utils/security/token";
import { env } from "../../config/config.service";
import { ProviderEnum, RoleEnum } from "../../Utils/enums/user.enum";
import { DriverModel } from "../../DB/models/driver.model";

class AuthService {
  constructor() {}

  async verifyGoogleToken(idToken: string) {
    if (!idToken || typeof idToken !== "string") {
      throw new BadRequestException("Invalid Google token");
    }
    const client = new OAuth2Client();
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      });
      return ticket.getPayload();
    } catch {
      throw new BadRequestException("Invalid Google token");
    }
  }

  signup = async (req: Request, res: Response): Promise<Response> => {
    const { firstname, lastname, username, email, password }: ISignupDTO =
      req.body;
    const userExist = await UserModel.findOne({ email }).select("email");
    if (userExist) throw new ConflictException("User already exists");
    const otp = generateOTP();
    const hashedOtp = await generateHash(otp);
    await set({ key: `otp:confirm:${email}`, value: hashedOtp, ttl: 10 * 60 });
    const [user] = await UserModel.create(
      [
        {
          firstname,
          lastname,
          username,
          email,
          password,
        },
      ],
      { validateBeforeSave: true },
    );

    emailEvents.emit("confirmEmail", {
      to: email,
      otp,
    });
    return res.status(201).json({ message: "Done", user });
  };

  confirmEmail = async (req: Request, res: Response): Promise<Response> => {
    const { otp, email }: IConfirmEmailDTO = req.body;
    const user = await UserModel.findOne({
      email,
      confirmedAt: { $exists: false },
    });
    if (!user) throw new NotFoundException("Invalid Account");

    const storedOtp = await get({ key: `otp:confirm:${email}` });
    if (!storedOtp) throw new BadRequestException("OTP has expired");

    const isMatch = await compareHash(otp, storedOtp);
    if (!isMatch) throw new BadRequestException("Invalid OTP");

    await UserModel.updateOne(
      { email },
      {
        confirmedAt: new Date(),
      },
    );

    await del({ key: `otp:confirm:${email}` });

    return res.status(200).json({ message: "User confirmed Successfully" });
  };

  login = async (req: Request, res: Response) => {
    const { password, email }: ILoginDTO = req.body;
    const user = await UserModel.findOne({
      email,
      confirmedAt: { $exists: true },
    });
    if (!user || !user.password)
      throw new NotFoundException("Invalid Credentials");
    if (user.role === RoleEnum.DRIVER) {
      const driverStatus = await DriverModel.findOne({
        userId: user._id,
        isOnline: false,
      }).select("_id").lean();
      if (!driverStatus)
        throw new UnauthorizedException("only one login session per driver");
    }
    if (!(await compareHash(password, user.password)))
      throw new BadRequestException("Invalid Credentials");

    const credentials = createLoginCredentials(user);

    return res
      .status(200)
      .json({ message: "Logged in Successfully", credentials });
  };

  getMe = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user?._id;
    const user = await UserModel.findById(userId).select("-password");
    return res
      .status(200)
      .json({ message: "user retrieved successfully", user });
  };

  forgetPassword = async (req: Request, res: Response): Promise<Response> => {
    const { email }: IForgetPasswordDTO = req.body;
    const user = await UserModel.findOne({ email });
    if (!user) throw new NotFoundException("Invalid Email");
    const otp = generateOTP();
    const hashedOtp = await generateHash(otp);
    await set({ key: `otp:forget:${email}`, value: hashedOtp, ttl: 10 * 60 });
    emailEvents.emit("forgetPassword", {
      to: email,
      otp,
    });
    return res.status(200).json({ message: "OTP has been sent to your email" });
  };

  resetPassword = async (req: Request, res: Response): Promise<Response> => {
    const { email, otp, password }: IResetPasswordDTO = req.body;
    const user = await UserModel.findOne({ email });
    if (!user) throw new NotFoundException("Invalid email");
    const storedOtp = await get({ key: `otp:forget:${email}` });
    if (!storedOtp) throw new BadRequestException("OTP has expired");

    const isMatch = await compareHash(otp, storedOtp);
    if (!isMatch) throw new BadRequestException("Invalid OTP");
    user.password = password;

    await user.save();

    await del({ key: `otp:forget:${email}` });

    return res.status(200).json({ message: "Password Reset Successfully" });
  };

  logout = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!._id.toString();
    const jti = req.decoded?.jti?.toString();
    if (!jti) throw new BadRequestException("Invalid Token");
    // The refresh token shares this jti, so keep the key for the refresh token's lifetime.
    await set({
      key: revokeTokenKey({ userId, jti }),
      value: jti,
      ttl: env.REFRESH_TOKEN_USER_EXPIRATION,
    });

    return res.status(200).json({ message: "Logout Successfully" });
  };

  loginWithGoogle = async (req: Request, res: Response): Promise<Response> => {
    const { idToken }: IGoogleLoginDTO = req.body;
    const payload = await this.verifyGoogleToken(idToken);
    if (!payload) throw new BadRequestException("Invalid Google token");
    const { email, email_verified, given_name, family_name, picture } = payload;
    if (!email_verified || !email)
      throw new BadRequestException("Email not verified");
    const user = await UserModel.findOne({ email });
    if (user && user.role === RoleEnum.DRIVER) {
      const driverStatus = await DriverModel.findOne({
        userId: user._id,
        isOnline: false,
      }).select("_id").lean();
      if (!driverStatus)
        throw new UnauthorizedException("only one login session per driver");
    }
    if (user) {
      const tokens = createLoginCredentials(user);
      return res
        .status(200)
        .json({ message: "Logged in Successfully", tokens });
    }

    if (!given_name || !family_name || !picture)
      throw new BadRequestException("Invalid Google Token payload");

    const newUser = await UserModel.create({
      firstname: given_name,
      lastname: family_name,
      email,
      provider: ProviderEnum.GOOGLE,
      profilePicture: picture,
    });
    const tokens = createLoginCredentials(newUser);
    return res.status(200).json({ message: "Logged in Successfully", tokens });
  };

  refresh = async (req: Request, res: Response): Promise<Response> => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw new BadRequestException("Refresh token is required");
    }
    const token = await refreshLoginCredentials(refreshToken);

    return res.status(200).json({
      message: "Token refreshed successfully",
      token,
    });
  };
}

export default new AuthService();
