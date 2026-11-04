import type { Pool } from "pg";

export async function currentFoodtruckId(db: Pool): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM foodtrucks LIMIT 2",
  );

  if (rows.length !== 1) {
    throw new Error("expected exactly one foodtruck");
  }

  return rows[0]!.id;
}
