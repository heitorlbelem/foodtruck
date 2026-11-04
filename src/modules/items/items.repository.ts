import type { Queryable } from "../../infra/db/pool.ts";
import type { Addon } from "../addons/addons.repository.ts";

export type Item = {
  id: string;
  category_id: string;
  name: string;
  price_cents: number;
  ingredients: string[];
  addons: Addon[];
};

export type ItemRow = Omit<Item, "ingredients" | "addons">;

type ItemLock = {
  id: string;
  name: string;
  price_cents: number;
  archived: boolean;
  foodtruck_id: string;
};

type ItemFields = { category_id: string; name: string; price_cents: number };

const COLUMNS = "id, category_id, name, price_cents";

export function makeItemRepository(db: Queryable) {
  return {
    async list(foodtruckId: string): Promise<Item[]> {
      const { rows } = await db.query<Item>(
        `SELECT ${COLUMNS},
                coalesce(
                  (SELECT array_agg(ingredient.name ORDER BY ingredient.sort_order)
                     FROM item_ingredients ingredient
                    WHERE ingredient.item_id = items.id),
                  '{}'
                ) AS ingredients,
                coalesce(
                  (SELECT json_agg(
                            json_build_object(
                              'id', addon.id,
                              'name', addon.name,
                              'price_cents', addon.price_cents
                            )
                            ORDER BY addon.name
                          )
                     FROM item_addons link
                     JOIN addons addon ON addon.id = link.addon_id
                    WHERE link.item_id = items.id AND addon.archived_at IS NULL),
                  '[]'
                ) AS addons
           FROM items
          WHERE foodtruck_id = $1 AND archived_at IS NULL
          ORDER BY name`,
        [foodtruckId],
      );

      return rows;
    },

    async create(foodtruckId: string, input: ItemFields): Promise<ItemRow> {
      const { rows } = await db.query<ItemRow>(
        `INSERT INTO items (foodtruck_id, category_id, name, price_cents)
         VALUES ($1, $2, $3, $4)
         RETURNING ${COLUMNS}`,
        [foodtruckId, input.category_id, input.name, input.price_cents],
      );

      return rows[0]!;
    },

    async update(
      id: string,
      input: Partial<ItemFields>,
    ): Promise<(ItemRow & { foodtruck_id: string }) | undefined> {
      const { rows } = await db.query<ItemRow & { foodtruck_id: string }>(
        `UPDATE items
            SET category_id = coalesce($2, category_id),
                name = coalesce($3, name),
                price_cents = coalesce($4, price_cents),
                updated_at = now()
          WHERE id = $1 AND archived_at IS NULL
          RETURNING ${COLUMNS}, foodtruck_id`,
        [
          id,
          input.category_id ?? null,
          input.name ?? null,
          input.price_cents ?? null,
        ],
      );

      return rows[0];
    },

    async lock(
      id: string,
    ): Promise<{ archived: boolean; category_id: string } | undefined> {
      const { rows } = await db.query<{
        archived: boolean;
        category_id: string;
      }>(
        `SELECT archived_at IS NOT NULL AS archived, category_id FROM items
          WHERE id = $1
            FOR UPDATE`,
        [id],
      );

      return rows[0];
    },

    async lockSharedMany(ids: string[]): Promise<ItemLock[]> {
      const { rows } = await db.query<ItemLock>(
        `SELECT id, name, price_cents, archived_at IS NOT NULL AS archived,
                foodtruck_id
           FROM items
          WHERE id = ANY($1::uuid[])
            FOR SHARE`,
        [ids],
      );

      return rows;
    },

    async archive(id: string): Promise<void> {
      await db.query(
        `UPDATE items
            SET archived_at = now(), updated_at = now()
          WHERE id = $1`,
        [id],
      );
    },

    async restore(id: string): Promise<ItemRow> {
      const { rows } = await db.query<ItemRow>(
        `UPDATE items
            SET archived_at = NULL, updated_at = now()
          WHERE id = $1
          RETURNING ${COLUMNS}`,
        [id],
      );

      return rows[0]!;
    },

    async findArchivedIdByName(
      foodtruckId: string,
      name: string,
    ): Promise<string | undefined> {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM items
          WHERE foodtruck_id = $1 AND name = $2 AND archived_at IS NOT NULL`,
        [foodtruckId, name],
      );

      return rows[0]?.id;
    },

    async replaceIngredients(
      itemId: string,
      ingredients: string[],
    ): Promise<void> {
      await db.query("DELETE FROM item_ingredients WHERE item_id = $1", [
        itemId,
      ]);
      await db.query(
        `INSERT INTO item_ingredients (item_id, name, sort_order)
         SELECT $1, name, ordinality - 1
           FROM unnest($2::text[]) WITH ORDINALITY AS listed(name, ordinality)`,
        [itemId, ingredients],
      );
    },

    async replaceAddonLinks(itemId: string, addonIds: string[]): Promise<void> {
      await db.query("DELETE FROM item_addons WHERE item_id = $1", [itemId]);
      await db.query(
        `INSERT INTO item_addons (item_id, addon_id)
         SELECT $1, unnest($2::uuid[])`,
        [itemId, addonIds],
      );
    },

    async ingredients(itemId: string): Promise<string[]> {
      const { rows } = await db.query<{ name: string }>(
        `SELECT name FROM item_ingredients
          WHERE item_id = $1
          ORDER BY sort_order`,
        [itemId],
      );

      return rows.map((row) => row.name);
    },

    async liveAddons(itemId: string): Promise<Addon[]> {
      const { rows } = await db.query<Addon>(
        `SELECT addon.id, addon.name, addon.price_cents
           FROM item_addons link
           JOIN addons addon ON addon.id = link.addon_id
          WHERE link.item_id = $1 AND addon.archived_at IS NULL
          ORDER BY addon.name`,
        [itemId],
      );

      return rows;
    },

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
