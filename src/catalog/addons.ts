import type { Pool } from "pg";

export type Addon = { id: string; name: string; price_cents: number };

type AddonFields = { name: string; price_cents: number };

const COLUMNS = "id, name, price_cents";

export async function listAddons(
  db: Pool,
  foodtruckId: string,
): Promise<Addon[]> {
  const { rows } = await db.query<Addon>(
    `SELECT ${COLUMNS} FROM addons
      WHERE foodtruck_id = $1 AND archived_at IS NULL
      ORDER BY name`,
    [foodtruckId],
  );

  return rows;
}

export async function createAddon(
  db: Pool,
  foodtruckId: string,
  input: AddonFields,
): Promise<Addon> {
  const { rows } = await db.query<Addon>(
    `INSERT INTO addons (foodtruck_id, name, price_cents)
     VALUES ($1, $2, $3)
     RETURNING ${COLUMNS}`,
    [foodtruckId, input.name, input.price_cents],
  );

  return rows[0]!;
}

export async function updateAddon(
  db: Pool,
  id: string,
  input: Partial<AddonFields>,
): Promise<Addon | undefined> {
  const { rows } = await db.query<Addon>(
    `UPDATE addons
        SET name = coalesce($2, name),
            price_cents = coalesce($3, price_cents),
            updated_at = now()
      WHERE id = $1 AND archived_at IS NULL
      RETURNING ${COLUMNS}`,
    [id, input.name ?? null, input.price_cents ?? null],
  );

  return rows[0];
}

export async function archiveAddon(db: Pool, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE addons
        SET archived_at = now(), updated_at = now()
      WHERE id = $1 AND archived_at IS NULL`,
    [id],
  );

  return rowCount === 1;
}
