import type { FastifyInstance } from "fastify";

import { makeFoodtruckRepository } from "../modules/foodtruck/foodtruck.repository.ts";
import { readMenu } from "../catalog/menu.ts";
import { addonSchema } from "../modules/addons/addons.schemas.ts";
import { categorySchema } from "../modules/categories/categories.schemas.ts";
import { comboSchema } from "../modules/combos/combos.schemas.ts";
import { itemSchema } from "../modules/items/items.schemas.ts";

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
