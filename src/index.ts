import { bootstrap } from "./app.controller"

bootstrap().catch((error: unknown) => {
  console.log("failed to start", error)
  process.exit(1)
})
