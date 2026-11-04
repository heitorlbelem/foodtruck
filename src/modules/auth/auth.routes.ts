import type { FastifyPluginAsync } from "fastify";

import { AppError } from "../../shared/errors.ts";
import { makeUserRepository } from "../users/users.repository.ts";
import { makeAuthService } from "./auth.service.ts";
import {
  loginSchema,
  logoutSchema,
  meSchema,
  refreshSchema,
} from "./auth.schemas.ts";

export const authRoutes: FastifyPluginAsync = async (app) => {
  const service = makeAuthService({ db: app.db, secret: app.auth.secret });
  const users = makeUserRepository(app.db);
  const { limiter } = app.auth;

  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    { schema: loginSchema, config: { public: true } },
    async (request) => {
      const { email, password } = request.body;
      const { ip } = request;

      const verdict = await limiter.attempt(email, ip);
      if (!verdict.allowed) {
        throw new AppError(
          429,
          "TOO_MANY_ATTEMPTS",
          "too many failed login attempts",
          { retry_after_seconds: verdict.retryAfterSeconds },
        );
      }

      try {
        const pair = await service.login(email, password, {
          ip,
          ...(request.headers["user-agent"]
            ? { userAgent: request.headers["user-agent"] }
            : {}),
        });
        await limiter.succeed(email, ip);
        return pair;
      } catch (error) {
        throw error;
      }
    },
  );

  app.post<{ Body: { refresh_token: string } }>(
    "/auth/refresh",
    { schema: refreshSchema, config: { public: true } },
    async (request) => service.refresh(request.body.refresh_token),
  );

  app.post(
    "/auth/logout",
    { schema: logoutSchema, config: { permission: "session" } },
    async (request, reply) => {
      await service.logout(request.user!.sessionId);

      return reply.code(204).send();
    },
  );

  app.get(
    "/auth/me",
    { schema: meSchema, config: { permission: "session" } },
    async (request) => {
      const user = await users.findById(request.user!.id);

      if (!user?.active) {
        throw new AppError(401, "UNAUTHENTICATED", "authentication required");
      }

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      };
    },
  );
};
