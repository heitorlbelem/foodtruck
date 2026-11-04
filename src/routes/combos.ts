import type { FastifyInstance } from "fastify";

import {
  archiveCombo,
  type ComboInput,
  createCombo,
  listCombos,
  SuggestedPriceTooHighError,
  UnavailableItemsError,
  UnknownCategoriesError,
  updateCombo,
} from "../catalog/combos.ts";
import { currentFoodtruckId } from "../catalog/foodtruck.ts";
import { isUniqueViolation } from "../infra/db/errors.ts";
import { conflict, notFound, unprocessable } from "./http-errors.ts";
import { idParams, MAX_QUANTITY, priceCents, uuid } from "./schemas.ts";

type IdParams = { id: string };

export const comboSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    price_cents: { type: "integer" },
    suggested_price_cents: { type: "integer" },
    components: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          item_id: { type: "string" },
          quantity: { type: "integer" },
          swap_category_id: { type: ["string", "null"] },
        },
      },
    },
  },
};

const bodyProperties = {
  name: { type: "string", minLength: 1 },
  price_cents: priceCents,
  components: {
    type: "array",
    minItems: 1,
    maxItems: 50,
    items: {
      type: "object",
      properties: {
        item_id: uuid,
        quantity: { type: "integer", minimum: 1, maximum: MAX_QUANTITY },
        swap_category_id: uuid,
      },
      required: ["item_id", "quantity"],
      additionalProperties: false,
    },
  },
};

export async function comboRoutes(app: FastifyInstance) {
  app.get(
    "/combos",
    { schema: { response: { 200: { type: "array", items: comboSchema } } } },
    async () => listCombos(app.db, await currentFoodtruckId(app.db)),
  );

  app.post<{ Body: ComboInput }>(
    "/combos",
    {
      schema: {
        body: {
          type: "object",
          properties: bodyProperties,
          required: ["name", "components"],
          additionalProperties: false,
        },
        response: { 201: comboSchema },
      },
    },
    async (request, reply) => {
      const foodtruckId = await currentFoodtruckId(app.db);
      const combo = await createCombo(app.db, foodtruckId, request.body).catch(
        rethrowWriteError(request.body),
      );

      return reply.code(201).send(combo);
    },
  );

  app.patch<{ Params: IdParams; Body: Partial<ComboInput> }>(
    "/combos/:id",
    {
      schema: {
        params: idParams,
        body: {
          type: "object",
          properties: bodyProperties,
          additionalProperties: false,
        },
        response: { 200: comboSchema },
      },
    },
    async (request) => {
      const combo = await updateCombo(
        app.db,
        request.params.id,
        request.body,
      ).catch(rethrowWriteError(request.body));

      if (!combo) {
        throw notFound("combo not found");
      }

      return combo;
    },
  );

  app.delete<{ Params: IdParams }>(
    "/combos/:id",
    { schema: { params: idParams } },
    async (request, reply) => {
      if (!(await archiveCombo(app.db, request.params.id))) {
        throw notFound("combo not found");
      }

      return reply.code(204).send();
    },
  );
}

function rethrowWriteError(body: Partial<ComboInput>) {
  return (error: unknown): never => {
    if (error instanceof UnavailableItemsError) {
      throw unprocessable(
        `items ${error.itemIds.join(", ")} do not exist or are archived`,
      );
    }

    if (error instanceof UnknownCategoriesError) {
      throw unprocessable(
        `swap categories ${error.categoryIds.join(", ")} do not exist`,
      );
    }

    if (error instanceof SuggestedPriceTooHighError) {
      throw unprocessable(
        `the suggested price ${error.suggestedPriceCents} is above the ceiling; set price_cents by hand`,
      );
    }

    if (isUniqueViolation(error)) {
      throw conflict(`a combo named "${body.name}" already exists`);
    }

    throw error;
  };
}
