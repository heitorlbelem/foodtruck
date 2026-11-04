import type { FastifyPluginAsync } from "fastify";

import { makeFoodtruckRepository } from "../foodtruck/foodtruck.repository.ts";
import { makeCategoryRepository } from "./categories.repository.ts";
import {
  archiveCategorySchema,
  createCategorySchema,
  listCategoriesSchema,
  restoreCategorySchema,
  updateCategorySchema,
} from "./categories.schemas.ts";
import { makeCategoryService } from "./categories.service.ts";

type CategoryBody = { name: string; sort_order?: number };
type IdParams = { id: string };

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  const foodtrucks = makeFoodtruckRepository(app.db);
  const categories = makeCategoryRepository(app.db);
  const service = makeCategoryService({ db: app.db });

  app.get("/categories", { schema: listCategoriesSchema }, async () =>
    categories.list(await foodtrucks.currentId()),
  );

  app.post<{ Body: CategoryBody }>(
    "/categories",
    { schema: createCategorySchema },
    async (request, reply) => {
      const category = await service.create(
        await foodtrucks.currentId(),
        request.body,
      );

      return reply.code(201).send(category);
    },
  );

  app.patch<{ Params: IdParams; Body: Partial<CategoryBody> }>(
    "/categories/:id",
    { schema: updateCategorySchema },
    async (request) =>
      service.update(
        await foodtrucks.currentId(),
        request.params.id,
        request.body,
      ),
  );

  app.delete<{ Params: IdParams }>(
    "/categories/:id",
    { schema: archiveCategorySchema },
    async (request, reply) => {
      await service.archive(request.params.id);

      return reply.code(204).send();
    },
  );

  app.post<{ Params: IdParams }>(
    "/categories/:id/restore",
    { schema: restoreCategorySchema },
    async (request) => service.restore(request.params.id),
  );
};
