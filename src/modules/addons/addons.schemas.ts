import {
  archivedQuery,
  centsField,
  errors,
  idField,
  idParams,
  priceCents,
} from "../../shared/schemas.ts";

const tags = ["adicionais"];

export const addonSchema = {
  $id: "Addon",
  type: "object",
  properties: {
    id: idField,
    name: { type: "string" },
    price_cents: centsField,
  },
  required: ["id", "name", "price_cents"],
};

const bodyProperties = {
  name: { type: "string", minLength: 1 },
  price_cents: priceCents,
};

const NOT_FOUND =
  "`ADDON_NOT_FOUND`: o adicional não existe ou está arquivado.";
const NAME_TAKEN =
  "`NAME_TAKEN`: já existe um adicional ativo com esse nome. `NAME_TAKEN_ARCHIVED`: o nome é de um adicional arquivado; `details.archived_id` aponta para ele.";

export const listAddonsSchema = {
  tags,
  summary: "Listar adicionais",
  description:
    "Lista os adicionais por nome. Com `?archived=true`, lista só os arquivados.",
  querystring: archivedQuery,
  response: {
    200: {
      description: "Adicionais.",
      type: "array",
      items: { $ref: "Addon#" },
    },
    ...errors({}),
  },
};

export const createAddonSchema = {
  tags,
  summary: "Criar adicional",
  description:
    "Cria um adicional com preço próprio. Depois, ligue-o aos itens que o aceitam com `addon_ids` no item.",
  body: {
    type: "object",
    properties: bodyProperties,
    required: ["name", "price_cents"],
    additionalProperties: false,
    examples: [{ name: "Bacon", price_cents: 500 }],
  },
  response: {
    201: { description: "Adicional criado.", $ref: "Addon#" },
    ...errors({ 409: NAME_TAKEN }, { body: true }),
  },
};

export const updateAddonSchema = {
  tags,
  summary: "Alterar adicional",
  description: "Altera nome e/ou preço. Campos omitidos ficam como estão.",
  params: idParams,
  body: {
    type: "object",
    properties: bodyProperties,
    additionalProperties: false,
  },
  response: {
    200: { description: "Adicional alterado.", $ref: "Addon#" },
    ...errors({ 404: NOT_FOUND, 409: NAME_TAKEN }, { body: true }),
  },
};

export const archiveAddonSchema = {
  tags,
  summary: "Arquivar adicional",
  description:
    "Arquiva o adicional. Recusado enquanto algum item ativo o aceitar; tire-o do `addon_ids` desses itens antes.",
  params: idParams,
  response: {
    204: { description: "Adicional arquivado.", type: "null" },
    ...errors({
      404: NOT_FOUND,
      409: "`IN_USE`: itens ativos aceitam o adicional; `details.items` lista quais.",
    }),
  },
};

export const restoreAddonSchema = {
  tags,
  summary: "Restaurar adicional",
  description:
    "Traz de volta um adicional arquivado, com o mesmo id. Ele volta a aparecer nos itens que já o aceitavam.",
  params: idParams,
  response: {
    200: { description: "Adicional restaurado.", $ref: "Addon#" },
    ...errors({
      404: "`ADDON_NOT_FOUND`: o adicional não existe.",
      409: "`NOT_ARCHIVED`: o adicional não está arquivado.",
    }),
  },
};
