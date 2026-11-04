import type { FastifyInstance } from "fastify";

import { AppError } from "../../shared/errors.ts";
import { makeLoginLimiter, type LoginLimiter } from "./login-limiter.ts";
import { loadJwtSecret, verifyAccessToken } from "./tokens.ts";

export type AuthUser = { id: string; role: string; sessionId: string };

declare module "fastify" {
  interface FastifyInstance {
    auth: { secret: Uint8Array; limiter: LoginLimiter };
  }

  interface FastifyRequest {
    user: AuthUser | null;
  }

  interface FastifyContextConfig {
    permission?: string;
    public?: true;
  }
}

const BEARER = /^Bearer ([^\s]+)$/;

export function registerAuth(app: FastifyInstance): void {
  app.decorate("auth", {
    secret: loadJwtSecret(),
    limiter: makeLoginLimiter(),
  });
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request) => {
    if (!request.routeOptions.config.permission) {
      return;
    }

    const token = BEARER.exec(request.headers.authorization ?? "")?.[1];
    const claims = token
      ? await verifyAccessToken(app.auth.secret, token)
      : null;

    if (!claims) {
      throw new AppError(401, "UNAUTHENTICATED", "authentication required");
    }

    request.user = { id: claims.sub, role: claims.role, sessionId: claims.sid };
  });
}
