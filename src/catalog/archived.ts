import type { Pool } from "pg";

export type RestoreResult<T> =
  | { status: "restored"; row: T }
  | { status: "not_found" }
  | { status: "not_archived" }
  | { status: "blocked"; blocked_by: string[] };

type ArchivableTable = "categories" | "items" | "addons" | "combos";

export async function archivedIdNamed(
  db: Pool,
  table: ArchivableTable,
  foodtruckId: string,
  name: string,
): Promise<string | undefined> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM ${table}
      WHERE foodtruck_id = $1 AND name = $2 AND archived_at IS NOT NULL`,
    [foodtruckId, name],
  );

  return rows[0]?.id;
}
