import { MAX_PRICE_CENTS } from "./money.ts";

export const MAX_QUANTITY = 99;

export const uuid = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
};

export const priceCents = {
  type: "integer",
  minimum: 0,
  maximum: MAX_PRICE_CENTS,
};

export const sortOrder = {
  type: "integer",
  minimum: -2147483648,
  maximum: 2147483647,
};

export const idParams = {
  type: "object",
  properties: { id: uuid },
  required: ["id"],
};

export const archivedQuery = {
  type: "object",
  properties: { archived: { type: "string", enum: ["true", "false"] } },
  additionalProperties: false,
};
