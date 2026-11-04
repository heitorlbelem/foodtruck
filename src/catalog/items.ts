import type { Pool, PoolClient } from "pg";

import { withTransaction } from "../infra/db/transaction.ts";
import type { Addon } from "./addons.ts";

export type Item = {
  id: string;
  category_id: string;
  name: string;
  price_cents: number;
  ingredients: string[];
  addons: Addon[];
};

type ItemFields = {
  category_id: string;
  name: string;
  price_cents: number;
  ingredients: string[];
  addon_ids: string[];
};

type ItemRow = Omit<Item, "ingredients" | "addons">;

export class UnavailableAddonsError extends Error {
  readonly addonIds: string[];

  constructor(addonIds: string[]) {
    super(`addons not available: ${addonIds.join(", ")}`);
    this.addonIds = addonIds;
  }
}

const COLUMNS = "id, category_id, name, price_cents";

const LIVE_ADDONS_OF_ITEM = `
  SELECT addon.id, addon.name, addon.price_cents
    FROM item_addons link
    JOIN addons addon ON addon.id = link.addon_id
   WHERE link.item_id = $1 AND addon.archived_at IS NULL
   ORDER BY addon.name`;

export async function listItems(
  db: Pool | PoolClient,
  foodtruckId: string,
): Promise<Item[]> {
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
}

export async function createItem(
  db: Pool,
  foodtruckId: string,
  input: Omit<ItemFields, "ingredients" | "addon_ids"> &
    Partial<Pick<ItemFields, "ingredients" | "addon_ids">>,
): Promise<Item> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<ItemRow>(
      `INSERT INTO items (foodtruck_id, category_id, name, price_cents)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [foodtruckId, input.category_id, input.name, input.price_cents],
    );
    const item = rows[0]!;
    await replaceIngredients(tx, item.id, input.ingredients);
    await replaceAddons(tx, item.id, input.addon_ids);

    return readChildren(tx, item);
  });
}

export async function updateItem(
  db: Pool,
  id: string,
  input: Partial<ItemFields>,
): Promise<Item | undefined> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<ItemRow>(
      `UPDATE items
          SET category_id = coalesce($2, category_id),
              name = coalesce($3, name),
              price_cents = coalesce($4, price_cents),
              updated_at = now()
        WHERE id = $1 AND archived_at IS NULL
        RETURNING ${COLUMNS}`,
      [
        id,
        input.category_id ?? null,
        input.name ?? null,
        input.price_cents ?? null,
      ],
    );
    const item = rows[0];

    if (!item) {
      return undefined;
    }

    await replaceIngredients(tx, item.id, input.ingredients);
    await replaceAddons(tx, item.id, input.addon_ids);

    return readChildren(tx, item);
  });
}

export type ArchiveResult = { archived: boolean; blocked_by: string[] };

export async function archiveItem(
  db: Pool,
  id: string,
): Promise<ArchiveResult> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT 1 FROM items
        WHERE id = $1 AND archived_at IS NULL
          FOR UPDATE`,
      [id],
    );

    if (rows.length === 0) {
      return { archived: false, blocked_by: [] };
    }

    const { rows: combos } = await tx.query<{ name: string }>(
      `SELECT DISTINCT combo.name
         FROM combo_components component
         JOIN combos combo ON combo.id = component.combo_id
        WHERE component.item_id = $1 AND combo.archived_at IS NULL
        ORDER BY combo.name`,
      [id],
    );

    if (combos.length > 0) {
      return { archived: false, blocked_by: combos.map((combo) => combo.name) };
    }

    await tx.query(
      `UPDATE items
          SET archived_at = now(), updated_at = now()
        WHERE id = $1`,
      [id],
    );

    return { archived: true, blocked_by: [] };
  });
}

async function replaceIngredients(
  tx: PoolClient,
  itemId: string,
  ingredients: string[] | undefined,
): Promise<void> {
  if (!ingredients) {
    return;
  }

  await tx.query("DELETE FROM item_ingredients WHERE item_id = $1", [itemId]);

  if (ingredients.length === 0) {
    return;
  }

  await tx.query(
    `INSERT INTO item_ingredients (item_id, name, sort_order)
     SELECT $1, name, ordinality - 1
       FROM unnest($2::text[]) WITH ORDINALITY AS listed(name, ordinality)`,
    [itemId, ingredients],
  );
}

async function replaceAddons(
  tx: PoolClient,
  itemId: string,
  addonIds: string[] | undefined,
): Promise<void> {
  if (!addonIds) {
    return;
  }

  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM addons
      WHERE id = ANY($2::uuid[])
        AND archived_at IS NULL
        AND foodtruck_id = (SELECT foodtruck_id FROM items WHERE id = $1)
        FOR SHARE`,
    [itemId, addonIds],
  );

  if (rows.length !== addonIds.length) {
    const live = new Set(rows.map((row) => row.id));
    throw new UnavailableAddonsError(addonIds.filter((id) => !live.has(id)));
  }

  await tx.query("DELETE FROM item_addons WHERE item_id = $1", [itemId]);
  await tx.query(
    `INSERT INTO item_addons (item_id, addon_id)
     SELECT $1, unnest($2::uuid[])`,
    [itemId, addonIds],
  );
}

async function readChildren(tx: PoolClient, item: ItemRow): Promise<Item> {
  const addons = await tx.query<Addon>(LIVE_ADDONS_OF_ITEM, [item.id]);

  return {
    ...item,
    ingredients: await readIngredients(tx, item.id),
    addons: addons.rows,
  };
}

async function readIngredients(
  tx: PoolClient,
  itemId: string,
): Promise<string[]> {
  const { rows } = await tx.query<{ name: string }>(
    `SELECT name FROM item_ingredients
      WHERE item_id = $1
      ORDER BY sort_order`,
    [itemId],
  );

  return rows.map((row) => row.name);
}
