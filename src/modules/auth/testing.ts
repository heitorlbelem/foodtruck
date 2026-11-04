import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { signAccessToken } from "./tokens.ts";

export async function authHeaders(
  app: FastifyInstance,
  role = "owner",
): Promise<{ authorization: string }> {
  const token = await signAccessToken(app.auth.secret, {
    sub: randomUUID(),
    sid: randomUUID(),
    role,
  });

  return { authorization: `Bearer ${token}` };
}
