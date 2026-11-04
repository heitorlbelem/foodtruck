import { bearer, errors } from "../../shared/schemas.ts";
import { addonExample } from "../addons/addons.schemas.ts";
import {
  categoryExample,
  categorySchema,
} from "../categories/categories.schemas.ts";
import { comboExample } from "../combos/combos.schemas.ts";
import { itemExample } from "../items/items.schemas.ts";

const menuCategoryExample = { ...categoryExample, items: [itemExample] };

export const menuCategorySchema = {
  $id: "MenuCategory",
  type: "object",
  description: "Uma categoria ativa com seus itens ativos, por nome.",
  properties: {
    ...categorySchema.properties,
    items: { type: "array", items: { $ref: "Item#" } },
  },
  required: [...categorySchema.required, "items"],
  examples: [menuCategoryExample],
};

export const menuSchema = {
  $id: "Menu",
  type: "object",
  properties: {
    categories: {
      type: "array",
      description:
        "Categorias ativas em ordem, cada uma com seus itens ativos.",
      items: { $ref: "MenuCategory#" },
    },
    addons: {
      type: "array",
      description: "Todos os adicionais ativos.",
      items: { $ref: "Addon#" },
    },
    combos: {
      type: "array",
      description: "Todos os combos ativos.",
      items: { $ref: "Combo#" },
    },
  },
  required: ["categories", "addons", "combos"],
  examples: [
    {
      categories: [menuCategoryExample],
      addons: [addonExample],
      combos: [comboExample],
    },
  ],
};

export const readMenuSchema = {
  tags: ["cardapio"],
  security: bearer,
  summary: "Ler o cardápio completo",
  description:
    "Devolve categorias com seus itens, adicionais e combos ativos, lidos num único snapshot consistente. É a chamada certa para a tela principal e para resolver os nomes que os combos referenciam por id. Não recebe parâmetros.",
  response: {
    200: { description: "Cardápio.", $ref: "Menu#" },
    ...errors({}, { input: false }),
  },
};
