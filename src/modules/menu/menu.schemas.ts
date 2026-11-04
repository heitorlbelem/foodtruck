import { addonSchema } from "../addons/addons.schemas.ts";
import { categorySchema } from "../categories/categories.schemas.ts";
import { comboSchema } from "../combos/combos.schemas.ts";
import { itemSchema } from "../items/items.schemas.ts";

const menuSchema = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ...categorySchema.properties,
          items: { type: "array", items: itemSchema },
        },
      },
    },
    addons: { type: "array", items: addonSchema },
    combos: { type: "array", items: comboSchema },
  },
};

export const readMenuSchema = { response: { 200: menuSchema } };
