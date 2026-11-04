import type { FastifyInstance } from "fastify";

import { checkDatabase } from "../infra/db/health.ts";

const healthSchema = {
  type: "object",
  properties: {
    updated_at: { type: "string" },
    database: {
      type: "object",
      properties: {
        status: { type: "string" },
        server_version: { type: "string" },
        latency_ms: { type: "number" },
        pool: {
          type: "object",
          properties: {
            total: { type: "number" },
            idle: { type: "number" },
            waiting: { type: "number" },
          },
        },
      },
    },
  },
};

const liveSchema = {
  type: "object",
  properties: { status: { type: "string" } },
};

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    "/health/live",
    { schema: { response: { 200: liveSchema } } },
    async () => ({ status: "ok" }),
  );

  app.get(
    "/health",
    { schema: { response: { 200: healthSchema, 503: healthSchema } } },
    async (request, reply) => {
      const { error, status, serverVersion, latencyMs, pool } =
        await checkDatabase(app.db);

      if (error) {
        request.log.error({ err: error }, "database health check failed");
        reply.code(503);
      }

      return {
        updated_at: new Date().toISOString(),
        database: {
          status,
          server_version: serverVersion,
          latency_ms: latencyMs,
          pool,
        },
      };
    },
  );
}
