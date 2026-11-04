import {
  archivedQuery,
  centsField,
  errors,
  LIST_BAD_REQUEST,
  idField,
  idParams,
  MAX_QUANTITY,
  priceCents,
  uuid,
} from "../../shared/schemas.ts";
import { itemExample } from "../items/items.schemas.ts";

const tags = ["combos"];

export const comboExample = {
  id: "6d8f0a2c-4e6a-4b8c-9d1f-3a5c7e9b1d3f",
  name: "Combo X-Burguer",
  price_cents: 3000,
  suggested_price_cents: 3200,
  components: [
    {
      id: "2c4e6a8b-0d2f-4a6c-8e1b-3d5f7a9c1e3b",
      item_id: itemExample.id,
      quantity: 1,
      swap_category_id: null,
    },
    {
      id: "8b0d2f4a-6c8e-4b1d-a3f5-7c9e1b3d5f7a",
      item_id: "7e9c1a3b-5d7f-4a2c-9e4b-6d8f0a2c4e6a",
      quantity: 1,
      swap_category_id: "3c5e7a9b-1d3f-4b5a-8c7e-9f1b3d5a7c9e",
    },
  ],
};

export const comboSchema = {
  $id: "Combo",
  type: "object",
  properties: {
    id: idField,
    name: { type: "string" },
    price_cents: { ...centsField, description: "Preço cobrado pelo combo." },
    suggested_price_cents: {
      ...centsField,
      description:
        "Soma de quantidade × preço atual de cada componente. Mostre ao lado do preço para a dona ver a diferença.",
    },
    components: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: idField,
          item_id: idField,
          quantity: { type: "integer" },
          swap_category_id: {
            type: ["string", "null"],
            format: "uuid",
            description:
              "Se presente, o cliente pode trocar este item por outro da categoria.",
          },
        },
        required: ["id", "item_id", "quantity", "swap_category_id"],
      },
      description:
        "Só ids. Resolva nomes e preços dos itens com `GET /api/v1/menu`.",
    },
  },
  required: [
    "id",
    "name",
    "price_cents",
    "suggested_price_cents",
    "components",
  ],
  examples: [comboExample],
};

const bodyProperties = {
  name: { type: "string", minLength: 1 },
  price_cents: {
    ...priceCents,
    description:
      "Centavos de real. Se omitido na criação, vira a soma dos componentes.",
  },
  components: {
    type: "array",
    minItems: 1,
    maxItems: 50,
    description: "Lista completa de componentes; no PATCH, substitui a atual.",
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

const NOT_FOUND = "`COMBO_NOT_FOUND`: o combo não existe ou está arquivado.";
const NAME_TAKEN =
  "`NAME_TAKEN`: já existe um combo ativo com esse nome. `NAME_TAKEN_ARCHIVED`: o nome é de um combo arquivado; `details.archived_id` aponta para ele.";
const INVALID_REFERENCE =
  "`INVALID_REFERENCE`: algum item ou categoria de troca não existe ou está arquivado; `details.ids` lista quais.";

export const listCombosSchema = {
  tags,
  summary: "Listar combos",
  description:
    "Lista os combos por nome. Com `?archived=true`, lista só os arquivados.",
  querystring: archivedQuery,
  response: {
    200: { description: "Combos.", type: "array", items: { $ref: "Combo#" } },
    ...errors({ 400: LIST_BAD_REQUEST }),
  },
};

export const createComboSchema = {
  tags,
  summary: "Criar combo",
  description:
    "Cria um combo a partir de itens ativos. Sem `price_cents`, o preço é a soma dos componentes.",
  body: {
    type: "object",
    properties: bodyProperties,
    required: ["name", "components"],
    additionalProperties: false,
    examples: [
      {
        name: "Combo X-Burguer",
        price_cents: 3200,
        components: [
          { item_id: "1f3a5c7e-9b2d-4f6a-8c0e-2a4c6e8b0d1f", quantity: 1 },
          {
            item_id: "7e9c1a3b-5d7f-4a2c-9e4b-6d8f0a2c4e6a",
            quantity: 1,
            swap_category_id: "3c5e7a9b-1d3f-4b5a-8c7e-9f1b3d5a7c9e",
          },
        ],
      },
    ],
  },
  response: {
    201: { description: "Combo criado.", $ref: "Combo#" },
    ...errors(
      {
        409: NAME_TAKEN,
        422: `${INVALID_REFERENCE} \`SUGGESTED_PRICE_TOO_HIGH\`: sem \`price_cents\`, a soma passou do teto; \`details.suggested_price_cents\` traz a soma e o preço precisa ser informado.`,
      },
      { body: true },
    ),
  },
};

export const updateComboSchema = {
  tags,
  summary: "Alterar combo",
  description:
    "Altera o combo. Campos omitidos ficam como estão; `components`, quando enviado, substitui a lista inteira. O preço não é recalculado.",
  params: idParams,
  body: {
    type: "object",
    properties: bodyProperties,
    additionalProperties: false,
  },
  response: {
    200: { description: "Combo alterado.", $ref: "Combo#" },
    ...errors(
      { 404: NOT_FOUND, 409: NAME_TAKEN, 422: INVALID_REFERENCE },
      { body: true },
    ),
  },
};

export const archiveComboSchema = {
  tags,
  summary: "Arquivar combo",
  description:
    "Arquiva o combo. Nada depende de combos, então não há bloqueio.",
  params: idParams,
  response: {
    204: { description: "Combo arquivado.", type: "null" },
    ...errors({ 404: NOT_FOUND }),
  },
};

export const restoreComboSchema = {
  tags,
  summary: "Restaurar combo",
  description:
    "Traz de volta um combo arquivado, com o mesmo id, preço e componentes. Exige os itens e as categorias de troca ativos.",
  params: idParams,
  response: {
    200: { description: "Combo restaurado.", $ref: "Combo#" },
    ...errors({
      404: "`COMBO_NOT_FOUND`: o combo não existe.",
      409: "`NOT_ARCHIVED`: o combo não está arquivado. `RESTORE_BLOCKED`: algum item ou categoria de troca está arquivado; `details.items` e `details.categories` listam quais.",
    }),
  },
};
