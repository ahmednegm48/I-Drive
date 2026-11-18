import { createClient } from "redis"
import { env } from "../../config/config.service"

export const redisClient = createClient({
  url: env.REDIS_URL,
  RESP: 2,
})
export const connectRedis = async (): Promise<void> => {
  try {
    await redisClient.connect()
    console.log("redis connected")
  } catch (error) {
    console.log("redis failed to connect", error)
  }
}
redisClient.on("error", function (err) {
  console.error("Redis client error:", err)
})
