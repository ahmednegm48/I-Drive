import { Router } from "express"
import DriverService from "./driver.service"
import {
  authentication,
  authorization,
} from "../../Middlewares/authentication.middleware"
import { RoleEnum } from "../../Utils/enums/user.enum"
import { localFileUpload } from "../../Utils/multer/multer.local"
import { validation } from "../../Middlewares/validation.middleware"
import { registerDriverSchema } from "./driver.validation"

const router = Router()

router.use(authentication())

const upload = localFileUpload({ folder: "drivers" })

const driverUploads = upload.fields([
  { name: "licenseImage", maxCount: 1 },
  { name: "nationalIdImage", maxCount: 1 },
])

router.post(
  "/register",
  driverUploads,
  validation(registerDriverSchema),
  DriverService.register,
)
router.get("/me", authorization([RoleEnum.DRIVER]), DriverService.me)
router.get(
  "/me/status",
  authorization([RoleEnum.DRIVER]),
  DriverService.isAvailable,
)

export default router
