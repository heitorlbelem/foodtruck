import type { Pool, PoolClient } from "pg";

import { withTransaction } from "../infra/db/transaction.ts";

export type Item = {
  id: string;
  category_id: string;
  name: string;
  price_cents: number;
  ingredients: string[];
};

type ItemFields = {
  category_id: string;
  name: string;
  price_cents: number;
  ingredients: string[];
};

type ItemRow = Omit<Item, "ingredients">;

const COLUMNS = "id, category_id, name, price_cents";

export async function listItems(
  db: Pool,
  foodtruckId: string,
): Promise<Item[]> {
  const { rows } = await db.query<Item>(
    `SELECT ${COLUMNS},
            coalesce(
              (SELECT array_agg(ingredient.name ORDER BY ingredient.sort_order)
                 FROM item_ingredients ingredient
                WHERE ingredient.item_id = items.id),
              '{}'
            ) AS ingredients
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
  input: Omit<ItemFields, "ingredients"> & { ingredients?: string[] },
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

    return { ...item, ingredients: await readIngredients(tx, item.id) };
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

    return { ...item, ingredients: await readIngredients(tx, item.id) };
  });
}

export async function archiveItem(db: Pool, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE items
        SET archived_at = now(), updated_at = now()
      WHERE id = $1 AND archived_at IS NULL`,
    [id],
  );

  return rowCount === 1;
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
