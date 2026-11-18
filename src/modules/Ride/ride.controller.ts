import { Router } from "express"
import {
  authentication,
  authorization,
} from "../../Middlewares/authentication.middleware"
import { validation } from "../../Middlewares/validation.middleware"
import { RoleEnum } from "../../Utils/enums/user.enum"
import rideService from "./ride.service"
import {
  acceptRideSchema,
  arriveRideSchema,
  cancelRideSchema,
  completeRideSchema,
  estimateRideSchema,
  getRideSchema,
  requestRideSchema,
  rideHistorySchema,
  startRideSchema,
} from "./ride.validation"

const router = Router()

router.use(authentication())

router.get("/estimate", validation(estimateRideSchema), rideService.estimate)
router.post(
  "/request",
  validation(requestRideSchema),
  rideService.request,
)
router.post(
  "/:id/accept",
  authorization([RoleEnum.DRIVER]),
  validation(acceptRideSchema),
  rideService.accept,
)
router.get("/history", validation(rideHistorySchema), rideService.history)
// Literal paths must stay above "/:id" or they'd be read as a ride id.
router.get("/active", rideService.active)
router.get("/:id", validation(getRideSchema), rideService.getById)
router.post(
  "/:id/arrived",
  authorization([RoleEnum.DRIVER]),
  validation(arriveRideSchema),
  rideService.arrive,
)
router.post(
  "/:id/start",
  authorization([RoleEnum.DRIVER]),
  validation(startRideSchema),
  rideService.start,
)
router.post(
  "/:id/complete",
  authorization([RoleEnum.DRIVER]),
  validation(completeRideSchema),
  rideService.complete,
)
router.post(
  "/:id/cancel",
  authorization([RoleEnum.RIDER, RoleEnum.DRIVER]),
  validation(cancelRideSchema),
  rideService.cancel,
)

export default router
