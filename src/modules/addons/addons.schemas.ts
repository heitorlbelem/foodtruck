import { idParams, priceCents, archivedQuery } from "../../shared/schemas.ts";

export const addonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    price_cents: { type: "integer" },
  },
};

const bodyProperties = {
  name: { type: "string", minLength: 1 },
  price_cents: priceCents,
};

export const listAddonsSchema = {
  querystring: archivedQuery,
  response: { 200: { type: "array", items: addonSchema } },
};

export const createAddonSchema = {
  body: {
    type: "object",
    properties: bodyProperties,
    required: ["name", "price_cents"],
    additionalProperties: false,
  },
  response: { 201: addonSchema },
};

export const updateAddonSchema = {
  params: idParams,
  body: {
    type: "object",
    properties: bodyProperties,
    additionalProperties: false,
  },
  response: { 200: addonSchema },
};

export const archiveAddonSchema = { params: idParams };

export const restoreAddonSchema = {
  params: idParams,
  response: { 200: addonSchema },
};
