import { JwtPayload, Secret, sign, SignOptions, verify } from "jsonwebtoken";
import { env } from "../../config/config.service";
import { UnauthorizedException } from "../response/error.response";
import { HUserDocument, UserModel } from "../../DB/models/user.model";
import { v4 as uuidv4 } from "uuid";
import { isTokenRevoked } from "../../DB/redis/redis.service";

export enum TokenEnum {
  ACCESS = "access",
  REFRESH = "refresh",
}

export interface ITokenPayload extends JwtPayload {
  _id: string;
}

export const generateToken = ({
  payload,
  secret,
  options,
}: {
  payload: object;
  secret: Secret;
  options: SignOptions;
}) => {
  return sign(payload, secret, options);
};

export const verifyToken = ({
  token,
  secret,
}: {
  token: string;
  secret: Secret;
}): ITokenPayload => {
  return verify(token, secret) as ITokenPayload;
};

const getSignature = (
  type: TokenEnum,
): {
  Secret: string;
  Expiration: number;
} => {
  if (type === TokenEnum.ACCESS) {
    const Secret = env.TOKEN_USER_SECRET;
    const Expiration = env.TOKEN_USER_EXPIRATION;

    return { Secret, Expiration };
  }
  const Secret = env.REFRESH_TOKEN_USER_SECRET;
  const Expiration = env.REFRESH_TOKEN_USER_EXPIRATION;

  return { Secret, Expiration };
};

// Shared by access and refresh checks: a verified token is still rejected when its
// payload is incomplete, it was revoked, its user is gone, or credentials changed after it was issued.
const resolveTokenUser = async (
  decoded: ITokenPayload,
): Promise<HUserDocument> => {
  if (!decoded._id || !decoded.jti || !decoded.iat)
    throw new UnauthorizedException("Invalid Token Payload");
  if (await isTokenRevoked({ userId: decoded._id, jti: decoded.jti }))
    throw new UnauthorizedException("Token Is Revoked");

  const user = await UserModel.findById(decoded._id);
  if (!user) throw new UnauthorizedException("Invalid or expired token");

  // iat has whole-second precision, so compare in seconds
  if (
    user.changeCredentialsTime &&
    decoded.iat < Math.floor(user.changeCredentialsTime.getTime() / 1000)
  )
    throw new UnauthorizedException("Credentials changed, please log in again");
  return user;
};

export const createLoginCredentials = (
  user: HUserDocument,
): {
  accessToken: string;
  refreshToken: string;
} => {
  const payload = { _id: user._id.toString() };
  const access = getSignature(TokenEnum.ACCESS);
  const refresh = getSignature(TokenEnum.REFRESH);
  const jwtid = uuidv4();

  const accessToken = generateToken({
    payload,
    secret: access.Secret,
    options: { expiresIn: access.Expiration, jwtid },
  });
  const refreshToken = generateToken({
    payload,
    secret: refresh.Secret,
    options: { expiresIn: refresh.Expiration, jwtid },
  });
  return { accessToken, refreshToken };
};

export const refreshLoginCredentials = async (
  refreshToken: string,
): Promise<{
  accessToken: string;
}> => {
  let decoded: ITokenPayload;
  try {
    decoded = verifyToken({
      token: refreshToken,
      secret: getSignature(TokenEnum.REFRESH).Secret,
    });
  } catch {
    throw new UnauthorizedException("Invalid or expired token");
  }
  await resolveTokenUser(decoded);

  const payload = { _id: decoded._id };
  const access = getSignature(TokenEnum.ACCESS);
  const jwtid = decoded.jti;

  const accessToken = generateToken({
    payload,
    secret: access.Secret,
    options: { expiresIn: access.Expiration, jwtid },
  });
  return { accessToken };
};

export const decodeToken = async ({
  authorization,
  tokenType = TokenEnum.ACCESS,
}: {
  authorization: string | undefined;
  tokenType?: TokenEnum;
}): Promise<{ user: HUserDocument; decoded: ITokenPayload }> => {
  if (!authorization) throw new UnauthorizedException("you are not Authorized");
  const [bearer, token] = authorization.split(" ");
  if (bearer !== "Bearer" || !token)
    throw new UnauthorizedException("Invalid token Format");
  let decoded: ITokenPayload;
  try {
    decoded = verifyToken({
      token,
      secret: getSignature(tokenType).Secret,
    });
  } catch {
    throw new UnauthorizedException("Invalid or expired token");
  }
  const user = await resolveTokenUser(decoded);
  return { user, decoded };
};
