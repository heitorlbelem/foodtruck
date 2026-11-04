import type { FastifyInstance } from "fastify";

import { makeFoodtruckRepository } from "../modules/foodtruck/foodtruck.repository.ts";
import {
  archiveItem,
  createItem,
  listItems,
  UnavailableAddonsError,
  UnavailableCategoryError,
  updateItem,
  restoreItem,
} from "../catalog/items.ts";
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from "../infra/db/errors.ts";
import { addonSchema } from "./addons.ts";
import { nameTaken, restoreRoute } from "./archiving.ts";
import { conflict, notFound, unprocessable } from "./http-errors.ts";
import { idParams, priceCents, uuid } from "./schemas.ts";

type ItemBody = {
  category_id: string;
  name: string;
  price_cents: number;
  ingredients: string[];
  addon_ids: string[];
};
type IdParams = { id: string };

export const itemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    category_id: { type: "string" },
    name: { type: "string" },
    price_cents: { type: "integer" },
    ingredients: { type: "array", items: { type: "string" } },
    addons: { type: "array", items: addonSchema },
  },
};

const bodyProperties = {
  category_id: uuid,
  name: { type: "string", minLength: 1 },
  price_cents: priceCents,
  ingredients: {
    type: "array",
    items: { type: "string", minLength: 1 },
    uniqueItems: true,
  },
  addon_ids: {
    type: "array",
    items: uuid,
    uniqueItems: true,
  },
};

export async function itemRoutes(app: FastifyInstance) {
  app.get(
    "/items",
    { schema: { response: { 200: { type: "array", items: itemSchema } } } },
    async () =>
      listItems(app.db, await makeFoodtruckRepository(app.db).currentId()),
  );

  app.post<{ Body: ItemBody }>(
    "/items",
    {
      schema: {
        body: {
          type: "object",
          properties: bodyProperties,
          required: ["category_id", "name", "price_cents"],
          additionalProperties: false,
        },
        response: { 201: itemSchema },
      },
    },
    async (request, reply) => {
      const foodtruckId = await makeFoodtruckRepository(app.db).currentId();
      const item = await createItem(app.db, foodtruckId, request.body).catch(
        rethrowWriteError(app, request.body),
      );

      return reply.code(201).send(item);
    },
  );

  app.patch<{ Params: IdParams; Body: Partial<ItemBody> }>(
    "/items/:id",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          properties: bodyProperties,
          additionalProperties: false,
        },
        response: { 200: itemSchema },
      },
    },
    async (request) => {
      const item = await updateItem(
        app.db,
        request.params.id,
        request.body,
      ).catch(rethrowWriteError(app, request.body));

      if (!item) {
        throw notFound("item not found");
      }

      return item;
    },
  );

  app.delete<{ Params: IdParams }>(
    "/items/:id",
    { schema: { params: idParams } },
    async (request, reply) => {
      const result = await archiveItem(app.db, request.params.id);

      if (result.blocked_by.length > 0) {
        throw conflict(
          `item is still used by combos: ${result.blocked_by.join(", ")}`,
        );
      }

      if (!result.archived) {
        throw notFound("item not found");
      }

      return reply.code(204).send();
    },
  );

  restoreRoute(app, {
    table: "items",
    noun: "item",
    schema: itemSchema,
    restore: restoreItem,
  });
}

function rethrowWriteError(app: FastifyInstance, body: Partial<ItemBody>) {
  return async (error: unknown): Promise<never> => {
    if (error instanceof UnavailableCategoryError) {
      throw unprocessable(
        `category ${error.categoryId} does not exist or is archived`,
      );
    }

    if (error instanceof UnavailableAddonsError) {
      throw unprocessable(
        `addons ${error.addonIds.join(", ")} do not exist or are archived`,
      );
    }

    if (isUniqueViolation(error)) {
      throw await nameTaken(
        app,
        "items",
        `an item named "${body.name}" already exists`,
        body.name,
      );
    }

    if (isForeignKeyViolation(error)) {
      throw unprocessable(`category ${body.category_id} does not exist`);
    }

    throw error;
  };
}
