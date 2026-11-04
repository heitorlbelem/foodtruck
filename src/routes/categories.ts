import type { FastifyInstance } from "fastify";

import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from "../catalog/categories.ts";
import { currentFoodtruckId } from "../catalog/foodtruck.ts";
import { isUniqueViolation } from "../infra/db/errors.ts";
import { conflict, notFound } from "./http-errors.ts";
import { idParams, sortOrder } from "./schemas.ts";

type CategoryBody = { name?: string; sort_order?: number };
type IdParams = { id: string };

export const categorySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    sort_order: { type: "integer" },
  },
};

const bodyProperties = {
  name: { type: "string", minLength: 1 },
  sort_order: sortOrder,
};

export async function categoryRoutes(app: FastifyInstance) {
  app.get(
    "/categories",
    { schema: { response: { 200: { type: "array", items: categorySchema } } } },
    async () => listCategories(app.db, await currentFoodtruckId(app.db)),
  );

  app.post<{ Body: CategoryBody & { name: string } }>(
    "/categories",
    {
      schema: {
        body: {
          type: "object",
          properties: bodyProperties,
          required: ["name"],
          additionalProperties: false,
        },
        response: { 201: categorySchema },
      },
    },
    async (request, reply) => {
      const foodtruckId = await currentFoodtruckId(app.db);
      const category = await createCategory(
        app.db,
        foodtruckId,
        request.body,
      ).catch(rethrowDuplicate(request.body.name));

      return reply.code(201).send(category);
    },
  );

  app.patch<{ Params: IdParams; Body: CategoryBody }>(
    "/categories/:id",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          properties: bodyProperties,
          additionalProperties: false,
        },
        response: { 200: categorySchema },
      },
    },
    async (request) => {
      const category = await updateCategory(
        app.db,
        request.params.id,
        request.body,
      ).catch(rethrowDuplicate(request.body.name));

      if (!category) {
        throw notFound("category not found");
      }

      return category;
    },
  );

  app.delete<{ Params: IdParams }>(
    "/categories/:id",
    { schema: { params: idParams } },
    async (request, reply) => {
      const result = await deleteCategory(app.db, request.params.id);

      if (!result.deleted && result.reason === "not_found") {
        throw notFound("category not found");
      }

      if (!result.deleted && result.reason === "has_items") {
        throw conflict(`category "${result.name}" still has items`);
      }

      if (!result.deleted) {
        throw conflict(
          `category "${result.name}" is the swap category of ${result.combos.join(", ")}`,
        );
      }

      return reply.code(204).send();
    },
  );
}

function rethrowDuplicate(name: string | undefined) {
  return (error: unknown): never => {
    if (isUniqueViolation(error)) {
      throw conflict(`a category named "${name}" already exists`);
    }

    throw error;
  };
}
