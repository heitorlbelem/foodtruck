import { ERROR_CODES } from "./error-codes.ts";
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
  description: "Centavos de real (inteiro). R$ 12,50 é 1250.",
};

export const sortOrder = {
  type: "integer",
  minimum: -2147483648,
  maximum: 2147483647,
};

export const idParams = {
  type: "object",
  properties: { id: { ...uuid, description: "Id do registro (uuid)." } },
  required: ["id"],
};

export const archivedQuery = {
  type: "object",
  properties: {
    archived: {
      type: "string",
      enum: ["true", "false"],
      description:
        "`true` lista só os arquivados; `false` ou ausente lista só os ativos.",
    },
  },
  additionalProperties: false,
};

export const idField = { type: "string", format: "uuid" };

export const centsField = {
  type: "integer",
  description: "Centavos de real (inteiro).",
};

const refList = {
  type: "array",
  items: {
    type: "object",
    properties: { id: idField, name: { type: "string" } },
    required: ["id", "name"],
    additionalProperties: false,
  },
};

export const errorSchema = {
  $id: "Error",
  type: "object",
  properties: {
    status_code: { type: "integer" },
    error: { type: "string" },
    code: { type: "string", enum: [...ERROR_CODES] },
    message: {
      type: "string",
      description:
        "Texto em inglês para depuração. A interface deve traduzir a partir de `code`.",
    },
    details: {
      type: "object",
      description:
        "Presente só em alguns códigos; veja a descrição de cada resposta.",
      properties: {
        archived_id: idField,
        items: refList,
        combos: refList,
        categories: refList,
        ids: { type: "array", items: idField },
        suggested_price_cents: centsField,
      },
      additionalProperties: false,
    },
  },
  required: ["status_code", "error", "code", "message"],
  additionalProperties: false,
};

export const BAD_REQUEST =
  "`VALIDATION_FAILED`: corpo, query ou id fora do schema. `MALFORMED_REQUEST`: JSON inválido, ou corpo vazio enviado com `Content-Type: application/json`.";

type ErrorStatus = 400 | 404 | 409 | 422;

export function errors(descriptions: Partial<Record<ErrorStatus, string>>) {
  return Object.fromEntries(
    Object.entries({ 400: BAD_REQUEST, ...descriptions }).map(
      ([status, description]) => [status, { description, $ref: "Error#" }],
    ),
  );
}
