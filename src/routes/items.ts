import type { FastifyInstance } from "fastify";

import { currentFoodtruckId } from "../catalog/foodtruck.ts";
import {
  archiveItem,
  createItem,
  listItems,
  UnavailableAddonsError,
  updateItem,
} from "../catalog/items.ts";
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from "../infra/db/errors.ts";
import { addonSchema } from "./addons.ts";
import { conflict, notFound, unprocessable } from "./http-errors.ts";

type ItemBody = {
  category_id: string;
  name: string;
  price_cents: number;
  ingredients: string[];
  addon_ids: string[];
};
type IdParams = { id: string };

const itemSchema = {
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
  category_id: { type: "string", format: "uuid" },
  name: { type: "string", minLength: 1 },
  price_cents: { type: "integer", minimum: 0 },
  ingredients: {
    type: "array",
    items: { type: "string", minLength: 1 },
    uniqueItems: true,
  },
  addon_ids: {
    type: "array",
    items: { type: "string", format: "uuid" },
    uniqueItems: true,
  },
};

const idParams = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" } },
  required: ["id"],
};

export async function itemRoutes(app: FastifyInstance) {
  app.get(
    "/items",
    { schema: { response: { 200: { type: "array", items: itemSchema } } } },
    async () => listItems(app.db, await currentFoodtruckId(app.db)),
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
      const foodtruckId = await currentFoodtruckId(app.db);
      const item = await createItem(app.db, foodtruckId, request.body).catch(
        rethrowWriteError(request.body),
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
      ).catch(rethrowWriteError(request.body));

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
      if (!(await archiveItem(app.db, request.params.id))) {
        throw notFound("item not found");
      }

      return reply.code(204).send();
    },
  );
}

function rethrowWriteError(body: Partial<ItemBody>) {
  return (error: unknown): never => {
    if (error instanceof UnavailableAddonsError) {
      throw unprocessable(
        `addons ${error.addonIds.join(", ")} do not exist or are archived`,
      );
    }

    if (isUniqueViolation(error)) {
      throw conflict(`an item named "${body.name}" already exists`);
    }

    if (isForeignKeyViolation(error)) {
      throw unprocessable(`category ${body.category_id} does not exist`);
    }

    throw error;
  };
}
