import type { FastifyInstance } from "fastify";

import {
  archiveAddon,
  createAddon,
  listAddons,
  updateAddon,
} from "../catalog/addons.ts";
import { currentFoodtruckId } from "../catalog/foodtruck.ts";
import { isUniqueViolation } from "../infra/db/errors.ts";
import { conflict, notFound } from "./http-errors.ts";

type AddonBody = { name: string; price_cents: number };
type IdParams = { id: string };

export const addonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    price_cents: { type: "integer" },
  },
};

const bodyProperties = {
  name: { type: "string", minLength: 1 },
  price_cents: { type: "integer", minimum: 0 },
};

const idParams = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" } },
  required: ["id"],
};

export async function addonRoutes(app: FastifyInstance) {
  app.get(
    "/addons",
    { schema: { response: { 200: { type: "array", items: addonSchema } } } },
    async () => listAddons(app.db, await currentFoodtruckId(app.db)),
  );

  app.post<{ Body: AddonBody }>(
    "/addons",
    {
      schema: {
        body: {
          type: "object",
          properties: bodyProperties,
          required: ["name", "price_cents"],
          additionalProperties: false,
        },
        response: { 201: addonSchema },
      },
    },
    async (request, reply) => {
      const foodtruckId = await currentFoodtruckId(app.db);
      const addon = await createAddon(app.db, foodtruckId, request.body).catch(
        rethrowWriteError(request.body),
      );

      return reply.code(201).send(addon);
    },
  );

  app.patch<{ Params: IdParams; Body: Partial<AddonBody> }>(
    "/addons/:id",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          properties: bodyProperties,
          additionalProperties: false,
        },
        response: { 200: addonSchema },
      },
    },
    async (request) => {
      const addon = await updateAddon(
        app.db,
        request.params.id,
        request.body,
      ).catch(rethrowWriteError(request.body));

      if (!addon) {
        throw notFound("addon not found");
      }

      return addon;
    },
  );

  app.delete<{ Params: IdParams }>(
    "/addons/:id",
    { schema: { params: idParams } },
    async (request, reply) => {
      const result = await archiveAddon(app.db, request.params.id);

      if (result.blocked_by.length > 0) {
        throw conflict(
          `addon is still used by items: ${result.blocked_by.join(", ")}`,
        );
      }

      if (!result.archived) {
        throw notFound("addon not found");
      }

      return reply.code(204).send();
    },
  );
}

function rethrowWriteError(body: Partial<AddonBody>) {
  return (error: unknown): never => {
    if (isUniqueViolation(error)) {
      throw conflict(`an addon named "${body.name}" already exists`);
    }

    throw error;
  };
}
