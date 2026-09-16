import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
export class DomainError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export function validPassword(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw new DomainError("PASSWORD_MUST_BE_12_TO_128_CHARACTERS");
}
export async function hashPassword(password: string): Promise<string> {
  validPassword(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt-v1$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  if (typeof password !== "string" || password.length > 128) return false;
  const parts = encoded.split("$");
  if (
    parts.length !== 3 ||
    parts[0] !== "scrypt-v1" ||
    !/^[a-f0-9]{32}$/.test(parts[1]) ||
    !/^[a-f0-9]{128}$/.test(parts[2])
  )
    return false;
  return timingSafeEqual(
    await derive(password, Buffer.from(parts[1], "hex")),
    Buffer.from(parts[2], "hex"),
  );
}
export function normalizeRegistration(input: any) {
  if (!input || typeof input !== "object")
    throw new DomainError("INVALID_REGISTRATION");
  const email =
    typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const username =
    typeof input.username === "string"
      ? input.username.trim().toLowerCase()
      : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new DomainError("INVALID_EMAIL");
  if (!/^[a-z0-9_]{3,32}$/.test(username))
    throw new DomainError("INVALID_USERNAME");
  validPassword(input.password);
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : username;
  if (!displayName || displayName.length > 80)
    throw new DomainError("INVALID_DISPLAY_NAME");
  return { email, username, password: input.password, displayName };
}
