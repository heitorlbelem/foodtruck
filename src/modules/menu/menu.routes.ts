import type { FastifyPluginAsync } from "fastify";

import { makeFoodtruckRepository } from "../foodtruck/foodtruck.repository.ts";
import { readMenuSchema } from "./menu.schemas.ts";
import { makeMenuService } from "./menu.service.ts";

export const menuRoutes: FastifyPluginAsync = async (app) => {
  const foodtrucks = makeFoodtruckRepository(app.db);
  const service = makeMenuService({ db: app.db });

  app.get(
    "/menu",
    { schema: readMenuSchema, config: { permission: "catalog:read" } },
    async () => service.read(await foodtrucks.currentId()),
  );
};
