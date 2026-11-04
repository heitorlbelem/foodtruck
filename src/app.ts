import { STATUS_CODES } from "node:http";

import Fastify, { type FastifyError, type FastifyServerOptions } from "fastify";
import type { Pool } from "pg";

import { createPool } from "./infra/db/pool.ts";
import { authRoutes } from "./modules/auth/auth.routes.ts";
import { registerAuth } from "./modules/auth/auth.plugin.ts";
import { addonRoutes } from "./modules/addons/addons.routes.ts";
import { categoryRoutes } from "./modules/categories/categories.routes.ts";
import { comboRoutes } from "./modules/combos/combos.routes.ts";
import { healthRoutes } from "./modules/health/health.routes.ts";
import { itemRoutes } from "./modules/items/items.routes.ts";
import { menuRoutes } from "./modules/menu/menu.routes.ts";
import { registerOpenapi } from "./modules/openapi/openapi.plugin.ts";
import { API_V1_PREFIX } from "./shared/api.ts";
import type { ErrorCode } from "./shared/error-codes.ts";
import { AppError, type ErrorDetails } from "./shared/errors.ts";

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
    trustProxy: (_address, hop) => hop < 1,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    ...opts,
  });

  app.removeContentTypeParser("text/plain");
  app.decorate("db", db);
  app.db.on("error", (error) =>
    app.log.error({ err: error }, "idle database client error"),
  );
  app.addHook("onClose", (instance) => instance.db.end());

  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send(
        errorBody(
          404,
          "NOT_FOUND",
          `Route ${request.method}:${request.url} not found`,
        ),
      ),
  );

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode === 401) {
        reply.header("WWW-Authenticate", "Bearer");
      }

      if (error.details?.retry_after_seconds !== undefined) {
        reply.header("Retry-After", String(error.details.retry_after_seconds));
      }

      return reply
        .code(error.statusCode)
        .send(
          errorBody(error.statusCode, error.code, error.message, error.details),
        );
    }

    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, "request failed");
    }

    reply
      .code(statusCode)
      .send(
        errorBody(
          statusCode,
          frameworkCode(error, statusCode),
          statusCode >= 500 ? undefined : error.message,
        ),
      );
  });

  registerOpenapi(app);
  registerAuth(app);
  app.register(healthRoutes);
  app.register(
    async (v1) => {
      v1.register(authRoutes);
      v1.register(categoryRoutes);
      v1.register(itemRoutes);
      v1.register(addonRoutes);
      v1.register(comboRoutes);
      v1.register(menuRoutes);
    },
    { prefix: API_V1_PREFIX },
  );

  return app;
}

function frameworkCode(error: FastifyError, statusCode: number): ErrorCode {
  if (error.validation) {
    return "VALIDATION_FAILED";
  }

  if (error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
    return "UNSUPPORTED_MEDIA_TYPE";
  }

  if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return "PAYLOAD_TOO_LARGE";
  }

  return statusCode >= 500 ? "INTERNAL_ERROR" : "MALFORMED_REQUEST";
}

function errorBody(
  statusCode: number,
  code: ErrorCode,
  message?: string,
  details?: ErrorDetails,
) {
  return {
    status_code: statusCode,
    error: STATUS_CODES[statusCode],
    code,
    message: message ?? STATUS_CODES[statusCode],
    ...(details ? { details } : {}),
  };
}
