import type { Pool, PoolClient } from "pg";

export async function withTransaction<T>(
  db: Pool,
  run: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const tx = await db.connect();

  try {
    await tx.query("BEGIN");
    const result = await run(tx);
    await tx.query("COMMIT");

    return result;
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    tx.release();
  }
}
