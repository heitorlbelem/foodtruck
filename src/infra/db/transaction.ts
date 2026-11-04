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

export async function withSnapshot<T>(
  db: Pool,
  run: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  return withTransaction(db, async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

    return run(tx);
  });
}
