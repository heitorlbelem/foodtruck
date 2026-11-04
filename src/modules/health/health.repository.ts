import type { Pool } from "pg";

export function makeHealthRepository(pool: Pool) {
  return { checkDatabase: () => checkDatabase(pool) };
}

export type HealthRepository = ReturnType<typeof makeHealthRepository>;

async function checkDatabase(pool: Pool) {
  const startedAt = performance.now();

  try {
    const { rows } = await pool.query<{ server_version: string }>(
      `SELECT current_setting('server_version') AS server_version`,
    );

    return {
      status: "ok" as const,
      serverVersion: rows[0]?.server_version,
      latencyMs: elapsedSince(startedAt),
      pool: statsOf(pool),
    };
  } catch (error) {
    return {
      status: "unavailable" as const,
      latencyMs: elapsedSince(startedAt),
      pool: statsOf(pool),
      error,
    };
  }
}

function statsOf(pool: Pool) {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

function elapsedSince(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}
