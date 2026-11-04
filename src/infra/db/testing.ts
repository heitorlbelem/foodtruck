import type { Pool } from "pg";

const KEPT_TABLES = new Set(["pgmigrations", "foodtrucks"]);

export async function resetCatalog(db: Pool): Promise<void> {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const tables = rows
    .map((row) => row.table_name)
    .filter((name) => !KEPT_TABLES.has(name));

  if (tables.length === 0) {
    return;
  }

  const list = tables.map((name) => `"${name}"`).join(", ");
  await db.query(`TRUNCATE ${list} CASCADE`);
}
