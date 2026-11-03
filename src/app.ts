import { STATUS_CODES } from "node:http";

import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import type { Pool } from "pg";

import { createPool } from "./infra/db/pool.ts";
import { healthRoutes } from "./routes/health.ts";

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
  }
}

export function buildApp(
  opts: FastifyServerOptions = {},
  db: Pool = createPool(),
) {
  const app = Fastify(opts);

  app.decorate("db", db);
  app.db.on("error", (error) =>
    app.log.error({ err: error }, "idle database client error"),
  );
  app.addHook("onClose", (instance) => instance.db.end());

  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send(errorBody(404, `Route ${request.method}:${request.url} not found`)),
  );

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, "request failed");
    }

    reply
      .code(statusCode)
      .send(
        errorBody(statusCode, statusCode >= 500 ? undefined : error.message),
      );
  });

  app.register(healthRoutes);

  return app;
}

function errorBody(statusCode: number, message?: string) {
  return {
    status_code: statusCode,
    error: STATUS_CODES[statusCode],
    message: message ?? STATUS_CODES[statusCode],
  };
}
