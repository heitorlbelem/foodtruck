import type { FastifyPluginAsync } from "fastify";

import type { ArchivedQuery } from "../../shared/api.ts";
import { makeFoodtruckRepository } from "../foodtruck/foodtruck.repository.ts";
import { makeItemRepository } from "./items.repository.ts";
import {
  archiveItemSchema,
  createItemSchema,
  listItemsSchema,
  restoreItemSchema,
  updateItemSchema,
} from "./items.schemas.ts";
import { type ItemInput, makeItemService } from "./items.service.ts";

type IdParams = { id: string };

export const itemRoutes: FastifyPluginAsync = async (app) => {
  const foodtrucks = makeFoodtruckRepository(app.db);
  const items = makeItemRepository(app.db);
  const service = makeItemService({ db: app.db });

  app.get<{ Querystring: ArchivedQuery }>(
    "/items",
    { schema: listItemsSchema, config: { permission: "catalog:read" } },
    async (request) =>
      items.list(await foodtrucks.currentId(), {
        archived: request.query.archived === "true",
      }),
  );

  app.post<{ Body: ItemInput }>(
    "/items",
    { schema: createItemSchema, config: { permission: "catalog:write" } },
    async (request, reply) => {
      const item = await service.create(
        await foodtrucks.currentId(),
        request.body,
      );

      return reply.code(201).send(item);
    },
  );

  app.patch<{ Params: IdParams; Body: Partial<ItemInput> }>(
    "/items/:id",
    { schema: updateItemSchema, config: { permission: "catalog:write" } },
    async (request) =>
      service.update(
        await foodtrucks.currentId(),
        request.params.id,
        request.body,
      ),
  );

  app.delete<{ Params: IdParams }>(
    "/items/:id",
    { schema: archiveItemSchema, config: { permission: "catalog:write" } },
    async (request, reply) => {
      await service.archive(request.params.id);

      return reply.code(204).send();
    },
  );

  app.post<{ Params: IdParams }>(
    "/items/:id/restore",
    { schema: restoreItemSchema, config: { permission: "catalog:write" } },
    async (request) => service.restore(request.params.id),
  );
};
