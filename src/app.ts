import { STATUS_CODES } from "node:http";

import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import type { Pool } from "pg";

import { createPool } from "./infra/db/pool.ts";
import { comboRoutes } from "./routes/combos.ts";
import { itemRoutes } from "./routes/items.ts";
import { menuRoutes } from "./routes/menu.ts";
import { addonRoutes } from "./modules/addons/addons.routes.ts";
import { categoryRoutes } from "./modules/categories/categories.routes.ts";
import { healthRoutes } from "./modules/health/health.routes.ts";
import { AppError } from "./shared/errors.ts";

declare module "fastify" {
  interface FastifyInstance {
    db: Pool;
  }
}

export function buildApp(
  opts: FastifyServerOptions = {},
  db: Pool = createPool(),
) {
  const app = Fastify({
    trustProxy: true,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    ...opts,
  });

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

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send(errorBody(error.statusCode, error.message));
    }

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
  app.register(categoryRoutes);
  app.register(itemRoutes);
  app.register(addonRoutes);
  app.register(comboRoutes);
  app.register(menuRoutes);

  return app;
}

function errorBody(statusCode: number, message?: string) {
  return {
    status_code: statusCode,
    error: STATUS_CODES[statusCode],
    message: message ?? STATUS_CODES[statusCode],
  };
}
