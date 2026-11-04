import type { Queryable } from "../../infra/db/pool.ts";
import { normalizeEmail } from "../users/passwords.ts";

export type LoginCheck =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Counter = { count: number; retry_after: number };

export function makeLoginLimiter(
  db: Queryable,
  {
    maxPerEmail = 5,
    maxPerIp = 20,
    windowMs = 15 * 60_000,
  }: { maxPerEmail?: number; maxPerIp?: number; windowMs?: number } = {},
) {
  const WINDOW = "$2::double precision * interval '1 millisecond'";
  const RETRY_AFTER = `greatest(1, ceil(extract(epoch FROM login_attempts.window_start + ${WINDOW} - now())))::int AS retry_after`;

  async function increment(key: string, max: number): Promise<Counter> {
    const { rows } = await db.query<Counter>(
      `INSERT INTO login_attempts (key, window_start, count)
       VALUES ($1, now(), 1)
       ON CONFLICT (key) DO UPDATE SET
         window_start = CASE
           WHEN login_attempts.window_start + ${WINDOW} <= now() THEN now()
           ELSE login_attempts.window_start
         END,
         count = CASE
           WHEN login_attempts.window_start + ${WINDOW} <= now() THEN 1
           ELSE least(login_attempts.count + 1, $3 + 1)
         END
       RETURNING count, ${RETRY_AFTER}`,
      [key, windowMs, max],
    );
    return rows[0]!;
  }

  async function blockedFor(key: string, max: number): Promise<number | null> {
    const { rows } = await db.query<Counter>(
      `SELECT count, ${RETRY_AFTER}
         FROM login_attempts
        WHERE key = $1
          AND window_start + ${WINDOW} > now()
          AND count >= $3`,
      [key, windowMs, max],
    );
    return rows[0]?.retry_after ?? null;
  }

  async function refund(key: string): Promise<void> {
    await db.query(
      `UPDATE login_attempts SET count = count - 1
        WHERE key = $1 AND count > 0 AND window_start + ${WINDOW} > now()`,
      [key, windowMs],
    );
  }

  return {
    async attempt(email: string, ip: string): Promise<LoginCheck> {
      const emailKey = `email:${normalizeEmail(email)}`;
      const ipKey = `ip:${ip}`;

      const byEmail = await increment(emailKey, maxPerEmail);

      if (byEmail.count > maxPerEmail) {
        const byIp = await blockedFor(ipKey, maxPerIp);

        return {
          allowed: false,
          retryAfterSeconds: Math.max(byEmail.retry_after, byIp ?? 0),
        };
      }

      const byIp = await increment(ipKey, maxPerIp);

      if (byIp.count > maxPerIp) {
        await refund(emailKey);

        return { allowed: false, retryAfterSeconds: byIp.retry_after };
      }

      return { allowed: true };
    },

    async succeed(email: string, ip: string): Promise<void> {
      await db.query("DELETE FROM login_attempts WHERE key = $1", [
        `email:${normalizeEmail(email)}`,
      ]);
      await refund(`ip:${ip}`);
    },

    async clear(): Promise<void> {
      await db.query("DELETE FROM login_attempts");
    },
  };
}

export type LoginLimiter = ReturnType<typeof makeLoginLimiter>;
