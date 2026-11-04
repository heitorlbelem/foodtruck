import {
  archivedQuery,
  bearer,
  centsField,
  errors,
  LIST_BAD_REQUEST,
  idField,
  idParams,
  priceCents,
  uuid,
} from "../../shared/schemas.ts";
import { addonExample } from "../addons/addons.schemas.ts";
import { categoryExample } from "../categories/categories.schemas.ts";

const tags = ["itens"];

export const itemExample = {
  id: "1f3a5c7e-9b2d-4f6a-8c0e-2a4c6e8b0d1f",
  category_id: categoryExample.id,
  name: "X-Burguer",
  price_cents: 2500,
  ingredients: ["alface", "tomate", "cebola"],
  addons: [addonExample],
};

export const itemSchema = {
  $id: "Item",
  type: "object",
  properties: {
    id: idField,
    category_id: idField,
    name: { type: "string" },
    price_cents: centsField,
    ingredients: {
      type: "array",
      items: { type: "string" },
      description:
        "Ingredientes que o cliente pode pedir para tirar, em ordem.",
    },
    addons: {
      type: "array",
      items: { $ref: "Addon#" },
      description: "Adicionais ativos que o item aceita, por nome.",
    },
  },
  required: [
    "id",
    "category_id",
    "name",
    "price_cents",
    "ingredients",
    "addons",
  ],
  examples: [itemExample],
};

const bodyProperties = {
  category_id: { ...uuid, description: "Categoria ativa do item." },
  name: { type: "string", minLength: 1 },
  price_cents: priceCents,
  ingredients: {
    type: "array",
    items: { type: "string", minLength: 1 },
    uniqueItems: true,
    description:
      "Lista completa de ingredientes removíveis; substitui a atual.",
  },
  addon_ids: {
    type: "array",
    items: uuid,
    uniqueItems: true,
    description: "Lista completa de adicionais aceitos; substitui a atual.",
  },
};

const NOT_FOUND = "`ITEM_NOT_FOUND`: o item não existe ou está arquivado.";
const NAME_TAKEN =
  "`NAME_TAKEN`: já existe um item ativo com esse nome. `NAME_TAKEN_ARCHIVED`: o nome é de um item arquivado; `details.archived_id` aponta para ele.";
const INVALID_REFERENCE =
  "`INVALID_REFERENCE`: a categoria ou algum adicional não existe ou está arquivado; `details.ids` lista quais.";

export const listItemsSchema = {
  tags,
  security: bearer,
  summary: "Listar itens",
  description:
    "Lista os itens por nome, com ingredientes e adicionais. Com `?archived=true`, lista só os arquivados.",
  querystring: archivedQuery,
  response: {
    200: { description: "Itens.", type: "array", items: { $ref: "Item#" } },
    ...errors({ 400: LIST_BAD_REQUEST }),
  },
};

export const createItemSchema = {
  tags,
  security: bearer,
  summary: "Criar item",
  description:
    "Cria um item numa categoria ativa, com ingredientes removíveis e adicionais aceitos opcionais.",
  body: {
    type: "object",
    properties: bodyProperties,
    required: ["category_id", "name", "price_cents"],
    additionalProperties: false,
    examples: [
      {
        category_id: "4b7c2a8e-0d1f-4c3a-9e6b-2f5d8a1c7e90",
        name: "X-Burguer",
        price_cents: 2500,
        ingredients: ["alface", "tomate", "cebola"],
        addon_ids: ["9a1e5c3b-7d2f-4e8a-b6c0-1d3f5a7e9c2b"],
      },
    ],
  },
  response: {
    201: { description: "Item criado.", $ref: "Item#" },
    ...errors({ 409: NAME_TAKEN, 422: INVALID_REFERENCE }, { body: true }),
  },
};

export const updateItemSchema = {
  tags,
  security: bearer,
  summary: "Alterar item",
  description:
    "Altera o item. Campos omitidos ficam como estão, mas `ingredients` e `addon_ids`, quando enviados, substituem a lista inteira.",
  params: idParams,
  body: {
    type: "object",
    properties: bodyProperties,
    additionalProperties: false,
  },
  response: {
    200: { description: "Item alterado.", $ref: "Item#" },
    ...errors(
      { 404: NOT_FOUND, 409: NAME_TAKEN, 422: INVALID_REFERENCE },
      { body: true },
    ),
  },
};

export const archiveItemSchema = {
  tags,
  security: bearer,
  summary: "Arquivar item",
  description:
    "Arquiva o item. Recusado enquanto ele for componente de algum combo ativo.",
  params: idParams,
  response: {
    204: { description: "Item arquivado.", type: "null" },
    ...errors({
      404: NOT_FOUND,
      409: "`IN_USE`: combos ativos usam o item; `details.combos` lista quais.",
    }),
  },
};

export const restoreItemSchema = {
  tags,
  security: bearer,
  summary: "Restaurar item",
  description:
    "Traz de volta um item arquivado, com o mesmo id, ingredientes e adicionais. Exige a categoria ativa.",
  params: idParams,
  response: {
    200: { description: "Item restaurado.", $ref: "Item#" },
    ...errors({
      404: "`ITEM_NOT_FOUND`: o item não existe.",
      409: "`NOT_ARCHIVED`: o item não está arquivado. `RESTORE_BLOCKED`: a categoria do item está arquivada; `details.categories` aponta para ela.",
    }),
  },
};
