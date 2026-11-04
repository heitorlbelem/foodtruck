import type { FastifyPluginAsync } from "fastify";

import type { ArchivedQuery } from "../../shared/api.ts";
import { makeFoodtruckRepository } from "../foodtruck/foodtruck.repository.ts";
import { type AddonInput, makeAddonRepository } from "./addons.repository.ts";
import {
  archiveAddonSchema,
  createAddonSchema,
  listAddonsSchema,
  restoreAddonSchema,
  updateAddonSchema,
} from "./addons.schemas.ts";
import { makeAddonService } from "./addons.service.ts";

type IdParams = { id: string };

export const addonRoutes: FastifyPluginAsync = async (app) => {
  const foodtrucks = makeFoodtruckRepository(app.db);
  const addons = makeAddonRepository(app.db);
  const service = makeAddonService({ db: app.db });

  app.get<{ Querystring: ArchivedQuery }>(
    "/addons",
    { schema: listAddonsSchema, config: { permission: "catalog:read" } },
    async (request) =>
      addons.list(await foodtrucks.currentId(), {
        archived: request.query.archived === "true",
      }),
  );

  app.post<{ Body: AddonInput }>(
    "/addons",
    { schema: createAddonSchema, config: { permission: "catalog:write" } },
    async (request, reply) => {
      const addon = await service.create(
        await foodtrucks.currentId(),
        request.body,
      );

      return reply.code(201).send(addon);
    },
  );

  app.patch<{ Params: IdParams; Body: Partial<AddonInput> }>(
    "/addons/:id",
    { schema: updateAddonSchema, config: { permission: "catalog:write" } },
    async (request) =>
      service.update(
        await foodtrucks.currentId(),
        request.params.id,
        request.body,
      ),
  );

  app.delete<{ Params: IdParams }>(
    "/addons/:id",
    { schema: archiveAddonSchema, config: { permission: "catalog:write" } },
    async (request, reply) => {
      await service.archive(request.params.id);

      return reply.code(204).send();
    },
  );

  app.post<{ Params: IdParams }>(
    "/addons/:id/restore",
    { schema: restoreAddonSchema, config: { permission: "catalog:write" } },
    async (request) => service.restore(request.params.id),
  );
};
