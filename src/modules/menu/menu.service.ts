import type { Pool } from "pg";

import { withSnapshot } from "../../infra/db/transaction.ts";
import {
  type Addon,
  makeAddonRepository,
} from "../addons/addons.repository.ts";
import {
  type Category,
  makeCategoryRepository,
} from "../categories/categories.repository.ts";
import { makeComboRepository } from "../combos/combos.repository.ts";
import { type Combo, toCombo } from "../combos/combos.service.ts";
import { type Item, makeItemRepository } from "../items/items.repository.ts";

export type Menu = {
  categories: (Category & { items: Item[] })[];
  addons: Addon[];
  combos: Combo[];
};

export function makeMenuService({ db }: { db: Pool }) {
  return {
    async read(foodtruckId: string): Promise<Menu> {
      return withSnapshot(db, async (tx) => {
        const categories = await makeCategoryRepository(tx).list(foodtruckId);
        const items = await makeItemRepository(tx).list(foodtruckId);
        const addons = await makeAddonRepository(tx).list(foodtruckId);
        const combos = await makeComboRepository(tx).list(foodtruckId);

        return {
          categories: categories.map((category) => ({
            ...category,
            items: items.filter((item) => item.category_id === category.id),
          })),
          addons,
          combos: combos.map(toCombo),
        };
      });
    },
  };
}

export type MenuService = ReturnType<typeof makeMenuService>;
