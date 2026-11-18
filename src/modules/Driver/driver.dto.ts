import { z } from "zod"
import { registerDriverSchema } from "./driver.validation"

export type IRegisterDriverDTO = z.infer<typeof registerDriverSchema.body>
export type IRegisterDriverFilesDTO = z.infer<typeof registerDriverSchema.files>
