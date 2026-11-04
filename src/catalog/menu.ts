import type { Pool } from "pg";

import { withTransaction } from "../infra/db/transaction.ts";
import {
  type Addon,
  makeAddonRepository,
} from "../modules/addons/addons.repository.ts";
import {
  type Category,
  makeCategoryRepository,
} from "../modules/categories/categories.repository.ts";
import { type Combo, listCombos } from "./combos.ts";
import {
  type Item,
  makeItemRepository,
} from "../modules/items/items.repository.ts";

export type Menu = {
  categories: (Category & { items: Item[] })[];
  addons: Addon[];
  combos: Combo[];
};

export async function readMenu(db: Pool, foodtruckId: string): Promise<Menu> {
  return withTransaction(db, async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const categories = await makeCategoryRepository(tx).list(foodtruckId);
    const items = await makeItemRepository(tx).list(foodtruckId);
    const addons = await makeAddonRepository(tx).list(foodtruckId);
    const combos = await listCombos(tx, foodtruckId);

    return {
      categories: categories.map((category) => ({
        ...category,
        items: items.filter((item) => item.category_id === category.id),
      })),
      addons,
      combos,
    };
  });
}
