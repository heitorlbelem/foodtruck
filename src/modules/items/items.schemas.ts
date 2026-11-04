import {
  idParams,
  priceCents,
  uuid,
  archivedQuery,
} from "../../shared/schemas.ts";
import { addonSchema } from "../addons/addons.schemas.ts";

export const itemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    category_id: { type: "string" },
    name: { type: "string" },
    price_cents: { type: "integer" },
    ingredients: { type: "array", items: { type: "string" } },
    addons: { type: "array", items: addonSchema },
  },
};

const bodyProperties = {
  category_id: uuid,
  name: { type: "string", minLength: 1 },
  price_cents: priceCents,
  ingredients: {
    type: "array",
    items: { type: "string", minLength: 1 },
    uniqueItems: true,
  },
  addon_ids: {
    type: "array",
    items: uuid,
    uniqueItems: true,
  },
};

export const listItemsSchema = {
  querystring: archivedQuery,
  response: { 200: { type: "array", items: itemSchema } },
};

export const createItemSchema = {
  body: {
    type: "object",
    properties: bodyProperties,
    required: ["category_id", "name", "price_cents"],
    additionalProperties: false,
  },
  response: { 201: itemSchema },
};

export const updateItemSchema = {
  params: idParams,
  body: {
    type: "object",
    properties: bodyProperties,
    additionalProperties: false,
  },
  response: { 200: itemSchema },
};

export const archiveItemSchema = { params: idParams };

export const restoreItemSchema = {
  params: idParams,
  response: { 200: itemSchema },
};
