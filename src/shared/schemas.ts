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
        retry_after_seconds: { type: "integer" },
      },
      additionalProperties: false,
    },
  },
  required: ["status_code", "error", "code", "message"],
  additionalProperties: false,
  examples: [
    {
      status_code: 409,
      error: "Conflict",
      code: "IN_USE",
      message: 'category "Lanches" is still used by items: X-Burguer',
      details: {
        items: [
          { id: "1f3a5c7e-9b2d-4f6a-8c0e-2a4c6e8b0d1f", name: "X-Burguer" },
        ],
      },
    },
    {
      status_code: 409,
      error: "Conflict",
      code: "NAME_TAKEN_ARCHIVED",
      message:
        'an item named "X-Burguer" already exists, archived; restore it with POST /api/v1/items/1f3a5c7e-9b2d-4f6a-8c0e-2a4c6e8b0d1f/restore',
      details: { archived_id: "1f3a5c7e-9b2d-4f6a-8c0e-2a4c6e8b0d1f" },
    },
  ],
};

export const BAD_REQUEST =
  "`VALIDATION_FAILED`: corpo, query ou id fora do schema. `MALFORMED_REQUEST`: JSON inválido, ou corpo vazio enviado com `Content-Type: application/json`.";

export const LIST_BAD_REQUEST = `${BAD_REQUEST} As listagens também recusam qualquer parâmetro de query desconhecido: só \`archived\` é aceito.`;

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429;

const INTERNAL_ERROR =
  "`INTERNAL_ERROR`: erro inesperado no servidor. Mostre uma mensagem genérica e ofereça tentar de novo.";

const BODY_ERRORS = {
  413: "`PAYLOAD_TOO_LARGE`: corpo acima do limite.",
  415: "`UNSUPPORTED_MEDIA_TYPE`: `Content-Type` não suportado; envie `application/json`.",
};

export function errors(
  descriptions: Partial<Record<ErrorStatus, string>>,
  { body = false, input = true }: { body?: boolean; input?: boolean } = {},
) {
  return Object.fromEntries(
    Object.entries({
      ...(input ? { 400: BAD_REQUEST } : {}),
      ...descriptions,
      ...(body ? BODY_ERRORS : {}),
      500: INTERNAL_ERROR,
    }).map(([status, description]) => [
      status,
      { description, $ref: "Error#" },
    ]),
  );
}
