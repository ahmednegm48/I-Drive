import type { ZodError, ZodType } from "zod"
import { NextFunction, Request, Response } from "express"
import { BadRequestException } from "../Utils/response/error.response"

//"body" | "query" | "params" | "headers" | "files" | "file"
type KeyReqType = keyof Request
type SchemaType = Partial<Record<KeyReqType, ZodType>>
export const validation = (schema: SchemaType) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const validationErrors: Array<{
      key: KeyReqType
      issues: Array<{ message: string; path: (string | number | symbol)[] }>
    }> = []

    for (const key of Object.keys(schema) as KeyReqType[]) {
      const keySchema = schema[key]
      if (!keySchema) continue

      const validationResults = keySchema.safeParse(req[key])
      if (validationResults.success) {
        // Hand the parsed (coerced/trimmed/defaulted) data to the service so it matches the DTO.
        // defineProperty also works where `req.query` is a getter (Express 5).
        Object.defineProperty(req, key, {
          value: validationResults.data,
          writable: true,
          configurable: true,
          enumerable: true,
        })
      } else {
        const ZodError = validationResults.error as ZodError
        validationErrors.push({
          key,
          issues: ZodError.issues.map((issue) => ({
            message: issue.message,
            path: issue.path,
          })),
        })
      }
      continue
    }
    if (validationErrors.length > 0) {
      throw new BadRequestException("Validation failed", {
        cause: validationErrors,
      })
    }
    next()
  }
}
