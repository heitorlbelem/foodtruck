import type { FastifyInstance } from "fastify";

import {
  archiveCategory,
  createCategory,
  listCategories,
  restoreCategory,
  updateCategory,
} from "../catalog/categories.ts";
import { makeFoodtruckRepository } from "../modules/foodtruck/foodtruck.repository.ts";
import { isUniqueViolation } from "../infra/db/errors.ts";
import { nameTaken, restoreRoute } from "./archiving.ts";
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
    async () =>
      listCategories(app.db, await makeFoodtruckRepository(app.db).currentId()),
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
      const foodtruckId = await makeFoodtruckRepository(app.db).currentId();
      const category = await createCategory(
        app.db,
        foodtruckId,
        request.body,
      ).catch(rethrowDuplicate(app, request.body.name));

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
      ).catch(rethrowDuplicate(app, request.body.name));

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
      const result = await archiveCategory(app.db, request.params.id);

      if (!result.archived && result.reason === "not_found") {
        throw notFound("category not found");
      }

      if (!result.archived) {
        const holders = [
          ...(result.items.length > 0
            ? [`items: ${result.items.join(", ")}`]
            : []),
          ...(result.combos.length > 0
            ? [`combos: ${result.combos.join(", ")}`]
            : []),
        ];

        throw conflict(
          `category "${result.name}" is still used by ${holders.join("; ")}`,
        );
      }

      return reply.code(204).send();
    },
  );

  restoreRoute(app, {
    table: "categories",
    noun: "category",
    schema: categorySchema,
    restore: restoreCategory,
  });
}

function rethrowDuplicate(app: FastifyInstance, name: string | undefined) {
  return async (error: unknown): Promise<never> => {
    if (isUniqueViolation(error)) {
      throw await nameTaken(
        app,
        "categories",
        `a category named "${name}" already exists`,
        name,
      );
    }

    throw error;
  };
}
