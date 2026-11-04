import { Pool, type PoolClient } from "pg";

export type Queryable = Pool | PoolClient;

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString });
  pool.on("error", () => {});

  return pool;
}
