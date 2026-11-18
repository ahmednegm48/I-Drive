import mongoose from "mongoose"
import { env } from "../config/config.service"

const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(env.DB_URI as string, {
      serverSelectionTimeoutMS: 5000,
    })
    console.log(`MongoDB Connected: ${conn.connection.host}`)
  } catch (error) {
    console.error(`connection error: ${(error as Error).message}`)
    throw error
  }
}

export default connectDB
