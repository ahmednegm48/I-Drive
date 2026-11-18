import { z } from "zod"

export const loginSchema = {
  body: z.strictObject({
    email: z.email({ error: "Invalid email address" }),
    password: z
      .string({ error: "Password is required" })
      .min(8, { error: "Password must be at least 8 characters long" })
      .max(64, { error: "Password must be at most 64 characters long" }),
  }),
}

export const confirmEmailSchema = {
  body: z.strictObject({
    email: z.email({ error: "Invalid email address" }),
    otp: z.string().regex(/^\d{6}$/),
  }),
}

export const forgetPasswordSchema = {
  body: z.strictObject({
    email: z.email({ error: "Invalid email address" }),
  }),
}

export const resetPasswordSchema = {
  body: z
    .strictObject({
      email: z.email({ error: "Invalid email address" }),
      otp: z.string().regex(/^\d{6}$/),
      password: z
        .string({ error: "Password is required" })
        .min(8, { error: "Password must be at least 8 characters long" })
        .max(64, { error: "Password must be at most 64 characters long" }),
      confirmPassword: z
        .string({ error: "Password is required" })
        .min(8, { error: "Password must be at least 8 characters long" })
        .max(64, { error: "Password must be at most 64 characters long" }),
    })
    .superRefine((data, ctx) => {
      if (data.password !== data.confirmPassword) {
        ctx.addIssue({
          code: "custom",
          path: ["confirmPassword"],
          message: "Passwords do not match",
        })
      }
    }),
}

export const signupSchema = {
  body: loginSchema.body.extend({
    firstname: z
      .string({ error: "First name is required" })
      .min(2, { error: "First name must be at least 2 characters long" })
      .max(25, { error: "First name must be at most 25 characters long" }),
    lastname: z
      .string({ error: "Last name is required" })
      .min(2, { error: "Last name must be at least 2 characters long" })
      .max(25, { error: "Last name must be at most 25 characters long" }),
    username: z
      .string()
      .min(2, { error: "Username must be at least 2 characters long" })
      .max(25, { error: "Username must be at most 25 characters long" }),
    phone: z.string(),
  }),
}

export const googleLoginSchema = {
  body: z.strictObject({
    idToken: z
      .string({ error: "Google id token is required" })
      .min(1, { error: "Google id token is required" }),
  }),
}

export const refreshSchema = {
  body: z.strictObject({
    refreshToken: z
      .string({ error: "Refresh token is required" })
      .min(1, { error: "Refresh token is required" }),
  }),
}
