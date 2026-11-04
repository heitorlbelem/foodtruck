import type { Queryable } from "../../infra/db/pool.ts";

export function makeComboRepository(db: Queryable) {
  return {
    async liveNamesWithSwapCategory(categoryId: string): Promise<string[]> {
      const { rows } = await db.query<{ name: string }>(
        `SELECT DISTINCT combo.name
           FROM combo_components component
           JOIN combos combo ON combo.id = component.combo_id
          WHERE component.swap_category_id = $1 AND combo.archived_at IS NULL
          ORDER BY combo.name`,
        [categoryId],
      );

      return rows.map((row) => row.name);
    },
  };
}

export type ComboRepository = ReturnType<typeof makeComboRepository>;
