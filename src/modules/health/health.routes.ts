import type { FastifyPluginAsync } from "fastify";

import { makeHealthRepository } from "./health.repository.ts";
import { healthSchema, liveSchema } from "./health.schemas.ts";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  const health = makeHealthRepository(app.db);

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
        await health.checkDatabase();

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
};
