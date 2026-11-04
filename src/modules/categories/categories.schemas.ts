import { idParams, sortOrder, archivedQuery } from "../../shared/schemas.ts";

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

export const listCategoriesSchema = {
  querystring: archivedQuery,
  response: { 200: { type: "array", items: categorySchema } },
};

export const createCategorySchema = {
  body: {
    type: "object",
    properties: bodyProperties,
    required: ["name"],
    additionalProperties: false,
  },
  response: { 201: categorySchema },
};

export const updateCategorySchema = {
  params: idParams,
  body: {
    type: "object",
    properties: bodyProperties,
    additionalProperties: false,
  },
  response: { 200: categorySchema },
};

export const archiveCategorySchema = { params: idParams };

export const restoreCategorySchema = {
  params: idParams,
  response: { 200: categorySchema },
};
