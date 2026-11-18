import { z } from "zod"
import {
  confirmEmailSchema,
  forgetPasswordSchema,
  googleLoginSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from "./auth.validation"

export type ISignupDTO = z.infer<typeof signupSchema.body>
export type ILoginDTO = z.infer<typeof loginSchema.body>
export type IForgetPasswordDTO = z.infer<typeof forgetPasswordSchema.body>
export type IResetPasswordDTO = z.infer<typeof resetPasswordSchema.body>
export type IConfirmEmailDTO = z.infer<typeof confirmEmailSchema.body>
export type IGoogleLoginDTO = z.infer<typeof googleLoginSchema.body>
