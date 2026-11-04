import type { FastifyInstance } from "fastify";

import { AppError } from "../../shared/errors.ts";
import { can, type Permission } from "./permissions.ts";
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
    permission?: Permission | "session";
    public?: true;
  }
}

const BEARER = /^Bearer ([^\s]+)$/i;
const OPEN_PREFIXES = ["/health", "/docs", "/openapi.json"];

function isOpen(url: string): boolean {
  return OPEN_PREFIXES.some(
    (prefix) => url === prefix || url.startsWith(`${prefix}/`),
  );
}

export function registerAuth(app: FastifyInstance): void {
  app.decorate("auth", {
    secret: loadJwtSecret(),
    limiter: makeLoginLimiter(app.db),
  });
  app.decorateRequest("user", null);

  app.addHook("onRoute", (route) => {
    const config = route.config ?? {};

    if (!isOpen(route.url) && !config.permission && !config.public) {
      const method = [route.method].flat().join(",");
      throw new Error(`route ${method} ${route.url} declares no permission`);
    }
  });

  app.addHook("onRequest", async (request) => {
    const { permission } = request.routeOptions.config;

    if (!permission) {
      return;
    }

    const token = BEARER.exec(request.headers.authorization ?? "")?.[1];
    const claims = token
      ? await verifyAccessToken(app.auth.secret, token)
      : null;

    if (!claims) {
      throw new AppError(401, "UNAUTHENTICATED", "authentication required");
    }

    if (permission !== "session" && !can(claims.role, permission)) {
      throw new AppError(403, "FORBIDDEN", "not allowed");
    }

    request.user = { id: claims.sub, role: claims.role, sessionId: claims.sid };
  });
}
