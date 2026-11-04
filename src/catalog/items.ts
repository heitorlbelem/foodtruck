import type { Pool } from "pg";

export type Item = {
  id: string;
  category_id: string;
  name: string;
  price_cents: number;
};

type ItemFields = { category_id: string; name: string; price_cents: number };

const COLUMNS = "id, category_id, name, price_cents";

export async function listItems(
  db: Pool,
  foodtruckId: string,
): Promise<Item[]> {
  const { rows } = await db.query<Item>(
    `SELECT ${COLUMNS} FROM items
      WHERE foodtruck_id = $1 AND archived_at IS NULL
      ORDER BY name`,
    [foodtruckId],
  );

  return rows;
}

export async function createItem(
  db: Pool,
  foodtruckId: string,
  input: ItemFields,
): Promise<Item> {
  const { rows } = await db.query<Item>(
    `INSERT INTO items (foodtruck_id, category_id, name, price_cents)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [foodtruckId, input.category_id, input.name, input.price_cents],
  );

  return rows[0]!;
}

export async function updateItem(
  db: Pool,
  id: string,
  input: Partial<ItemFields>,
): Promise<Item | undefined> {
  const { rows } = await db.query<Item>(
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

  return rows[0];
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
