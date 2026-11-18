import { compare, hash } from "bcrypt"
import { env } from "../../config/config.service"

export const generateHash = async (
  plaintext: string,
  saltRounds: number = env.SALT,
): Promise<string> => {
  return await hash(plaintext, saltRounds)
}

export const compareHash = async (
  plaintext: string,
  hashed: string,
): Promise<boolean> => {
  return await compare(plaintext, hashed)
}
