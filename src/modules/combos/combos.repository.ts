import type { Queryable } from "../../infra/db/pool.ts";
import type { ListFilter } from "../../shared/api.ts";
import type { Ref } from "../../shared/errors.ts";

export type ComboComponent = {
  id: string;
  item_id: string;
  quantity: number;
  swap_category_id: string | null;
};

export type ComboRow = {
  id: string;
  name: string;
  price_cents: number;
  components: (ComboComponent & { price_cents: number })[];
};

export type ComponentInput = {
  item_id: string;
  quantity: number;
  swap_category_id?: string;
};

const SELECT_COMBOS = `
  SELECT combo.id, combo.name, combo.price_cents,
         coalesce(
           (SELECT json_agg(
                     json_build_object(
                       'id', component.id,
                       'item_id', component.item_id,
                       'quantity', component.quantity,
                       'swap_category_id', component.swap_category_id,
                       'price_cents', item.price_cents
                     )
                     ORDER BY component.sort_order
                   )
              FROM combo_components component
              JOIN items item ON item.id = component.item_id
             WHERE component.combo_id = combo.id),
           '[]'
         ) AS components
    FROM combos combo`;

export function makeComboRepository(db: Queryable) {
  return {
    async list(
      foodtruckId: string,
      { archived }: ListFilter = { archived: false },
    ): Promise<ComboRow[]> {
      const { rows } = await db.query<ComboRow>(
        `${SELECT_COMBOS}
          WHERE combo.foodtruck_id = $1 AND (combo.archived_at IS NOT NULL) = $2
          ORDER BY combo.name`,
        [foodtruckId, archived],
      );

      return rows;
    },

    async findById(id: string): Promise<ComboRow | undefined> {
      const { rows } = await db.query<ComboRow>(
        `${SELECT_COMBOS} WHERE combo.id = $1`,
        [id],
      );

      return rows[0];
    },

    async create(
      foodtruckId: string,
      name: string,
      priceCents: number,
    ): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO combos (foodtruck_id, name, price_cents)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [foodtruckId, name, priceCents],
      );

      return rows[0]!.id;
    },

    async update(
      id: string,
      input: { name?: string; price_cents?: number },
    ): Promise<void> {
      await db.query(
        `UPDATE combos
            SET name = coalesce($2, name),
                price_cents = coalesce($3, price_cents),
                updated_at = now()
          WHERE id = $1`,
        [id, input.name ?? null, input.price_cents ?? null],
      );
    },

    async lock(
      id: string,
    ): Promise<{ archived: boolean; foodtruck_id: string } | undefined> {
      const { rows } = await db.query<{
        archived: boolean;
        foodtruck_id: string;
      }>(
        `SELECT archived_at IS NOT NULL AS archived, foodtruck_id FROM combos
          WHERE id = $1
            FOR UPDATE`,
        [id],
      );

      return rows[0];
    },

    async archive(id: string): Promise<boolean> {
      const { rowCount } = await db.query(
        `UPDATE combos
            SET archived_at = now(), updated_at = now()
          WHERE id = $1 AND archived_at IS NULL`,
        [id],
      );

      return rowCount === 1;
    },

    async restore(id: string): Promise<void> {
      await db.query(
        `UPDATE combos
            SET archived_at = NULL, updated_at = now()
          WHERE id = $1`,
        [id],
      );
    },

    async findArchivedIdByName(
      foodtruckId: string,
      name: string,
    ): Promise<string | undefined> {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM combos
          WHERE foodtruck_id = $1 AND name = $2 AND archived_at IS NOT NULL`,
        [foodtruckId, name],
      );

      return rows[0]?.id;
    },

    async replaceComponents(
      comboId: string,
      components: ComponentInput[],
    ): Promise<void> {
      await db.query("DELETE FROM combo_components WHERE combo_id = $1", [
        comboId,
      ]);
      await db.query(
        `INSERT INTO combo_components
           (combo_id, item_id, quantity, swap_category_id, sort_order)
         SELECT $1, listed.item_id, listed.quantity, listed.swap_category_id,
                listed.ordinality - 1
           FROM unnest($2::uuid[], $3::integer[], $4::uuid[])
                WITH ORDINALITY
                AS listed(item_id, quantity, swap_category_id, ordinality)`,
        [
          comboId,
          components.map((component) => component.item_id),
          components.map((component) => component.quantity),
          components.map((component) => component.swap_category_id ?? null),
        ],
      );
    },

    async references(
      comboId: string,
    ): Promise<{ itemIds: string[]; swapCategoryIds: string[] }> {
      const { rows } = await db.query<{
        item_id: string;
        swap_category_id: string | null;
      }>(
        `SELECT item_id, swap_category_id FROM combo_components
          WHERE combo_id = $1`,
        [comboId],
      );

      return {
        itemIds: [...new Set(rows.map((row) => row.item_id))],
        swapCategoryIds: [
          ...new Set(rows.flatMap((row) => row.swap_category_id ?? [])),
        ],
      };
    },

    async liveCombosWithSwapCategory(categoryId: string): Promise<Ref[]> {
      const { rows } = await db.query<Ref>(
        `SELECT DISTINCT combo.id, combo.name
           FROM combo_components component
           JOIN combos combo ON combo.id = component.combo_id
          WHERE component.swap_category_id = $1 AND combo.archived_at IS NULL
          ORDER BY combo.name`,
        [categoryId],
      );

      return rows;
    },

    async liveCombosContainingItem(itemId: string): Promise<Ref[]> {
      const { rows } = await db.query<Ref>(
        `SELECT DISTINCT combo.id, combo.name
           FROM combo_components component
           JOIN combos combo ON combo.id = component.combo_id
          WHERE component.item_id = $1 AND combo.archived_at IS NULL
          ORDER BY combo.name`,
        [itemId],
      );

      return rows;
    },
  };
}

export type ComboRepository = ReturnType<typeof makeComboRepository>;
