import {
  archivedQuery,
  bearer,
  errors,
  LIST_BAD_REQUEST,
  idField,
  idParams,
  sortOrder,
} from "../../shared/schemas.ts";

const tags = ["categorias"];

export const categoryExample = {
  id: "4b7c2a8e-0d1f-4c3a-9e6b-2f5d8a1c7e90",
  name: "Lanches",
  sort_order: 1,
};

export const categorySchema = {
  $id: "Category",
  type: "object",
  properties: {
    id: idField,
    name: { type: "string" },
    sort_order: {
      type: "integer",
      description: "Posição no cardápio; menor aparece primeiro.",
    },
  },
  required: ["id", "name", "sort_order"],
  examples: [categoryExample],
};

const bodyProperties = {
  name: { type: "string", minLength: 1 },
  sort_order: {
    ...sortOrder,
    description: "Posição no cardápio; menor aparece primeiro. Padrão 0.",
  },
};

const NOT_FOUND =
  "`CATEGORY_NOT_FOUND`: a categoria não existe ou está arquivada.";
const NAME_TAKEN =
  "`NAME_TAKEN`: já existe uma categoria ativa com esse nome. `NAME_TAKEN_ARCHIVED`: o nome é de uma categoria arquivada; `details.archived_id` aponta para ela, que pode ser restaurada.";

export const listCategoriesSchema = {
  tags,
  security: bearer,
  summary: "Listar categorias",
  description:
    "Lista as categorias ordenadas por `sort_order` e depois por nome. Com `?archived=true`, lista só as arquivadas.",
  querystring: archivedQuery,
  response: {
    200: {
      description: "Categorias.",
      type: "array",
      items: { $ref: "Category#" },
    },
    ...errors({ 400: LIST_BAD_REQUEST }),
  },
};

export const createCategorySchema = {
  tags,
  security: bearer,
  summary: "Criar categoria",
  description:
    "Cria uma categoria. É o primeiro passo do cardápio: todo item pertence a uma categoria.",
  body: {
    type: "object",
    properties: bodyProperties,
    required: ["name"],
    additionalProperties: false,
    examples: [{ name: "Lanches", sort_order: 1 }],
  },
  response: {
    201: { description: "Categoria criada.", $ref: "Category#" },
    ...errors({ 409: NAME_TAKEN }, { body: true }),
  },
};

export const updateCategorySchema = {
  tags,
  security: bearer,
  summary: "Alterar categoria",
  description:
    "Altera nome e/ou posição. Campos omitidos ficam como estão. Categorias arquivadas não podem ser alteradas.",
  params: idParams,
  body: {
    type: "object",
    properties: bodyProperties,
    additionalProperties: false,
  },
  response: {
    200: { description: "Categoria alterada.", $ref: "Category#" },
    ...errors({ 404: NOT_FOUND, 409: NAME_TAKEN }, { body: true }),
  },
};

export const archiveCategorySchema = {
  tags,
  security: bearer,
  summary: "Arquivar categoria",
  description:
    "Arquiva a categoria (nada é apagado). Recusado enquanto houver itens ativos nela ou combos ativos que a usam como categoria de troca.",
  params: idParams,
  response: {
    204: { description: "Categoria arquivada.", type: "null" },
    ...errors({
      404: NOT_FOUND,
      409: "`IN_USE`: há itens ou combos ativos usando a categoria; `details.items` e `details.combos` listam quais.",
    }),
  },
};

export const restoreCategorySchema = {
  tags,
  security: bearer,
  summary: "Restaurar categoria",
  description: "Traz de volta uma categoria arquivada, com o mesmo id.",
  params: idParams,
  response: {
    200: { description: "Categoria restaurada.", $ref: "Category#" },
    ...errors({
      404: "`CATEGORY_NOT_FOUND`: a categoria não existe.",
      409: "`NOT_ARCHIVED`: a categoria não está arquivada.",
    }),
  },
};
