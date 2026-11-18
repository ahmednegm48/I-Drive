import { NextFunction, Request, Response } from "express"
import { decodeToken, TokenEnum } from "../Utils/security/token"
import { ForbiddenException } from "../Utils/response/error.response"
import { RoleEnum } from "../Utils/enums/user.enum"

export const authentication = (tokenType: TokenEnum = TokenEnum.ACCESS) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { user, decoded } = await decodeToken({
      authorization: req.headers.authorization,
      tokenType,
    })
    req.user = user
    req.decoded = decoded
    next()
  }
}

export const authorization = (accessRoles: RoleEnum[] = []) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !accessRoles.includes(req.user.role))
      throw new ForbiddenException("Not Authorized")
    next()
  }
}
