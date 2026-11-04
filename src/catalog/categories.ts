import type { Pool } from "pg";

export type Category = { id: string; name: string; sort_order: number };

const COLUMNS = "id, name, sort_order";

export async function listCategories(
  db: Pool,
  foodtruckId: string,
): Promise<Category[]> {
  const { rows } = await db.query<Category>(
    `SELECT ${COLUMNS} FROM categories
      WHERE foodtruck_id = $1
      ORDER BY sort_order, name`,
    [foodtruckId],
  );

  return rows;
}

export async function createCategory(
  db: Pool,
  foodtruckId: string,
  input: { name: string; sort_order?: number },
): Promise<Category> {
  const { rows } = await db.query<Category>(
    `INSERT INTO categories (foodtruck_id, name, sort_order)
     VALUES ($1, $2, coalesce($3, 0))
     RETURNING ${COLUMNS}`,
    [foodtruckId, input.name, input.sort_order ?? null],
  );

  return rows[0]!;
}

export async function updateCategory(
  db: Pool,
  id: string,
  input: { name?: string; sort_order?: number },
): Promise<Category | undefined> {
  const { rows } = await db.query<Category>(
    `UPDATE categories
        SET name = coalesce($2, name),
            sort_order = coalesce($3, sort_order),
            updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id, input.name ?? null, input.sort_order ?? null],
  );

  return rows[0];
}

export async function deleteCategory(db: Pool, id: string): Promise<boolean> {
  const { rowCount } = await db.query("DELETE FROM categories WHERE id = $1", [
    id,
  ]);

  return rowCount === 1;
}
