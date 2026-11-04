import { errors } from "../../shared/schemas.ts";
import { categorySchema } from "../categories/categories.schemas.ts";

const menuSchema = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      description:
        "Categorias ativas em ordem, cada uma com seus itens ativos.",
      items: {
        type: "object",
        properties: {
          ...categorySchema.properties,
          items: { type: "array", items: { $ref: "Item#" } },
        },
        required: [...categorySchema.required, "items"],
      },
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
};

export const readMenuSchema = {
  tags: ["cardapio"],
  summary: "Ler o cardápio completo",
  description:
    "Devolve categorias com seus itens, adicionais e combos ativos, lidos num único snapshot consistente. É a chamada certa para a tela principal e para resolver os nomes que os combos referenciam por id.",
  response: {
    200: { description: "Cardápio.", ...menuSchema },
    ...errors({}),
  },
};
