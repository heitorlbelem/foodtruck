import {
  idParams,
  MAX_QUANTITY,
  priceCents,
  uuid,
  archivedQuery,
} from "../../shared/schemas.ts";

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

export const listCombosSchema = {
  querystring: archivedQuery,
  response: { 200: { type: "array", items: comboSchema } },
};

export const createComboSchema = {
  body: {
    type: "object",
    properties: bodyProperties,
    required: ["name", "components"],
    additionalProperties: false,
  },
  response: { 201: comboSchema },
};

export const updateComboSchema = {
  params: idParams,
  body: {
    type: "object",
    properties: bodyProperties,
    additionalProperties: false,
  },
  response: { 200: comboSchema },
};

export const archiveComboSchema = { params: idParams };

export const restoreComboSchema = {
  params: idParams,
  response: { 200: comboSchema },
};
