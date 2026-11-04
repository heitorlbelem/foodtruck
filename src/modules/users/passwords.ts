import { hash, verify } from "@node-rs/argon2";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const ARGON2ID = 2;

export function checkPassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters long`;
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID });
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch (error) {
    if ((error as { code?: unknown }).code === "InvalidArg") {
      return false;
    }
    throw error;
  }
}

const dummyHash = hashPassword("dummy-password-for-unknown-emails");

export async function verifyAgainstDummy(password: string): Promise<false> {
  await verifyPassword(await dummyHash, password);
  return false;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
