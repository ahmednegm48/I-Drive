import { authentication } from "../../Middlewares/authentication.middleware"
import { validation } from "../../Middlewares/validation.middleware"
import authService from "./auth.service"
import * as validators from "./auth.validation"
import { Router } from "express"

const router = Router()

router.post("/signup", validation(validators.signupSchema), authService.signup)
router.post(
  "/confirm-email",
  validation(validators.confirmEmailSchema),
  authService.confirmEmail,
)
router.post("/login", validation(validators.loginSchema), authService.login)
router.post(
  "/google-login",
  validation(validators.googleLoginSchema),
  authService.loginWithGoogle,
)

router.patch(
  "/forget-password",
  validation(validators.forgetPasswordSchema),
  authService.forgetPassword,
)

router.patch(
  "/reset-password",
  validation(validators.resetPasswordSchema),
  authService.resetPassword,
)

router.get("/me", authentication(), authService.getMe)
router.post("/logout", authentication(), authService.logout)
router.post("/refresh", validation(validators.refreshSchema), authService.refresh)

export default router
