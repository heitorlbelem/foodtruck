import type { Pool } from "pg";

// There is a single foodtruck until a network of them exists; every catalog
// row is attributed to it. A wrong row count would attribute rows to the wrong
// owner, so it fails loudly instead of picking one.
export async function currentFoodtruckId(db: Pool): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM foodtrucks LIMIT 2",
  );

  if (rows.length !== 1) {
    throw new Error("expected exactly one foodtruck");
  }

  return rows[0]!.id;
}
