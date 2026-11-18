import { z } from "zod"

const text = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, { error: `${label} must be at least ${min} characters long` })
    .max(max, { error: `${label} must be at most ${max} characters long` })

// Shape of a file saved by multer's disk storage (extra multer fields are kept).
const uploadedFile = z.looseObject({
  fieldname: z.string(),
  originalname: z.string(),
  mimetype: z.string(),
  size: z.number(),
  filename: z.string(),
  path: z.string(),
})

// multer.fields() puts each field under its name as an array; maxCount is 1.
const singleFile = (label: string) =>
  z.tuple([uploadedFile], { error: `${label} is required (exactly one file)` })

export const registerDriverSchema = {
  // multipart/form-data: every field arrives as a string
  body: z.strictObject({
    licenseNumber: text("License number", 3, 30),
    brand: text("Brand", 2, 30),
    model: text("Model", 1, 30),
    year: z.coerce
      .number({ error: "Year must be a number" })
      .int({ error: "Year must be an integer" })
      .min(1990, { error: "Year must be 1990 or later" })
      .max(new Date().getFullYear() + 1, { error: "Year is in the future" }),
    color: text("Color", 2, 20),
    plateNumber: text("Plate number", 2, 15).toUpperCase(),
  }),
  files: z.strictObject(
    {
      licenseImage: singleFile("License image"),
      nationalIdImage: singleFile("National ID image"),
    },
    { error: "License image and national ID image are required" },
  ),
}
