import express, { Express, Request, Response } from "express";
import cors from "cors";
import { env } from "./config/config.service";
import { corsOptions } from "./Utils/cors/cors";
import rateLimit, { RateLimitRequestHandler } from "express-rate-limit";
import authController from "./modules/Auth/auth.controller";
import driverController from "./modules/Driver/driver.controller";
import rideController from "./modules/Ride/ride.controller";
import {
  globalErrorHandler,
  NotFoundException,
} from "./Utils/response/error.response";
import connectDB from "./DB/connection";
import { connectRedis } from "./DB/redis/redis.connection";
import { join } from "node:path";
import { intializeSocket } from "./Utils/socket/socket.service";
import { startRideExpiryJob } from "./modules/Ride/ride.expiry";
import { resetOnlineDrivers } from "./Utils/socket/connected.users";

const limitter: RateLimitRequestHandler = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 50,
  message: {
    status: 429,
    message: "Too many requests, please try again later.",
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

export const bootstrap = async (): Promise<void> => {
  const app: Express = express();

  app.use(cors(corsOptions), limitter);
  app.use(express.json());
  app.use("/uploads", express.static(join(__dirname, "..", "uploads")));

  await connectDB();
  await connectRedis();
  await resetOnlineDrivers();

  app.get("/", (req: Request, res: Response) => {
    return res.status(200).json({ message: "Welcome to I-Drive" });
  });

  app.use("/auth", authController);
  app.use("/driver", driverController);
  app.use("/ride", rideController);

  app.use((req: Request, res: Response) => {
    throw new NotFoundException("Route not found");
  });
  app.use(globalErrorHandler);

  const httpServer = app.listen(env.PORT, () => {
    console.log(`Server is running on port ${env.PORT}`);
  });
  intializeSocket(httpServer);
  startRideExpiryJob();
};
