import type { Queryable } from "../../infra/db/pool.ts";

export function makeItemRepository(db: Queryable) {
  return {
    async liveNamesInCategory(categoryId: string): Promise<string[]> {
      const { rows } = await db.query<{ name: string }>(
        `SELECT name FROM items
          WHERE category_id = $1 AND archived_at IS NULL
          ORDER BY name`,
        [categoryId],
      );

      return rows.map((row) => row.name);
    },

    async liveNamesAcceptingAddon(addonId: string): Promise<string[]> {
      const { rows } = await db.query<{ name: string }>(
        `SELECT item.name
           FROM item_addons link
           JOIN items item ON item.id = link.item_id
          WHERE link.addon_id = $1 AND item.archived_at IS NULL
          ORDER BY item.name`,
        [addonId],
      );

      return rows.map((row) => row.name);
    },
  };
}

export type ItemRepository = ReturnType<typeof makeItemRepository>;
