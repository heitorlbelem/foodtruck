import type { FastifyInstance } from "fastify";

import { makeFoodtruckRepository } from "../modules/foodtruck/foodtruck.repository.ts";
import { readMenu } from "../catalog/menu.ts";
import { addonSchema } from "./addons.ts";
import { categorySchema } from "../modules/categories/categories.schemas.ts";
import { comboSchema } from "./combos.ts";
import { itemSchema } from "./items.ts";

const menuSchema = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ...categorySchema.properties,
          items: { type: "array", items: itemSchema },
        },
      },
    },
    addons: { type: "array", items: addonSchema },
    combos: { type: "array", items: comboSchema },
  },
};

export async function menuRoutes(app: FastifyInstance) {
  app.get("/menu", { schema: { response: { 200: menuSchema } } }, async () =>
    readMenu(app.db, await makeFoodtruckRepository(app.db).currentId()),
  );
}
