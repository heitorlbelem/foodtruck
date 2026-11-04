import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";

import { errorSchema } from "../../shared/schemas.ts";
import { addonSchema } from "../addons/addons.schemas.ts";
import { categorySchema } from "../categories/categories.schemas.ts";
import { comboSchema } from "../combos/combos.schemas.ts";
import { itemSchema } from "../items/items.schemas.ts";
import { GUIDE, TAGS } from "./guide.ts";

export function registerOpenapi(app: FastifyInstance) {
  for (const schema of [
    errorSchema,
    categorySchema,
    addonSchema,
    itemSchema,
    comboSchema,
  ]) {
    app.addSchema(schema);
  }

  app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "Foodtruck API", version: "1.0.0", description: GUIDE },
      servers: [{ url: "https://foodtruck-api.fly.dev" }],
      tags: TAGS.map((tag) => ({ ...tag })),
    },
    refResolver: {
      buildLocalReference: (json, _baseUri, _fragment, i) =>
        typeof json.$id === "string" ? json.$id : `def-${i}`,
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.get("/openapi.json", { schema: { hide: true } }, async () =>
    app.swagger(),
  );
}
