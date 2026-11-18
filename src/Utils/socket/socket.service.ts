import { Server, Socket } from "socket.io"
import { HUserDocument } from "../../DB/models/user.model.js"
import { decodeToken } from "../security/token.js"
import type { Server as HttpServer } from "node:http"
import { connectedSocketsEvent } from "./online.sockets.js"
import { GeoPoint, parseLocation } from "./connected.users.js"

export interface AuthedSocket extends Socket {
  user?: HUserDocument
  location?: GeoPoint
}

let io: Server | null = null

export const getIo = (): Server | null => io

export const intializeSocket = (httpServer: HttpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  })

  io.use(async (socket: AuthedSocket, next) => {
    try {
      const authorization =
        socket.handshake.auth?.token as string ||
        socket.handshake.headers.token as string
      const { user } = await decodeToken({ authorization })
      socket.user = user
      next()
    } catch (err) {
      next(new Error((err as Error).message) || "Unauthorized Socket")
    }
  })
  io.on("connection", (socket: AuthedSocket) => {
    const location = parseLocation(socket.handshake.auth)
    if (location) socket.location = location
    const user = socket.user
    const userId = user?._id.toString() as string
    console.log(`Socket connented: ${user?.firstname} (${socket.id})`)
    socket.join(userId)
    // Not awaited by Socket.IO, so catch here or a DB/Redis error becomes an unhandled rejection.
    connectedSocketsEvent(io!, socket).catch((err: unknown) =>
      console.error("[socket] connection setup failed", err),
    )
  })
  console.log("[socket] Socket.io Server is Ready")
  return io
}
