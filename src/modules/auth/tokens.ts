import { createHash, randomBytes } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

export const ACCESS_TOKEN_TTL_SECONDS = 900;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const ALGORITHM = "HS256";
const ISSUER = "foodtruck-api";
const AUDIENCE = "foodtruck-app";
const MIN_SECRET_BYTES = 32;

export type AccessClaims = { sub: string; sid: string; role: string };

export function loadJwtSecret(
  env: Record<string, string | undefined> = process.env,
): Uint8Array {
  const secret = new TextEncoder().encode(env.JWT_SECRET ?? "");

  if (secret.length < MIN_SECRET_BYTES) {
    throw new Error("JWT_SECRET must be at least 32 bytes");
  }

  return secret;
}

export function signAccessToken(
  secret: Uint8Array,
  claims: AccessClaims,
  now = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);

  return new SignJWT({ sid: claims.sid, role: claims.role })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_SECONDS)
    .sign(secret);
}

export async function verifyAccessToken(
  secret: Uint8Array,
  token: string,
): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ["sub", "iat", "exp"],
    });
    const { sub, sid, role } = payload;

    if (
      typeof sub !== "string" ||
      typeof sid !== "string" ||
      typeof role !== "string"
    ) {
      return null;
    }

    return { sub, sid, role };
  } catch {
    return null;
  }
}

export function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
