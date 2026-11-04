import type { Queryable } from "../../infra/db/pool.ts";
import type { User } from "../users/users.repository.ts";
import { SESSION_TTL_MS } from "./tokens.ts";

export type RevokeReason = "logout" | "reuse" | "admin";

export type LiveSession = {
  id: string;
  expires_at: Date;
  user: Pick<User, "id" | "name" | "email" | "role">;
};

export function makeSessionRepository(db: Queryable) {
  return {
    async create(input: {
      userId: string;
      tokenHash: string;
      userAgent?: string;
      ip?: string;
    }): Promise<{ id: string; expires_at: Date }> {
      const { rows } = await db.query<{ id: string; expires_at: Date }>(
        `WITH session AS (
           INSERT INTO sessions (user_id, created_at, expires_at, user_agent, ip)
           VALUES ($1, now(), now() + $2::double precision * interval '1 millisecond', $3, $4)
           RETURNING id, expires_at
         ), token AS (
           INSERT INTO refresh_tokens (token_hash, session_id)
           SELECT $5, id FROM session
         )
         SELECT id, expires_at FROM session`,
        [
          input.userId,
          SESSION_TTL_MS,
          input.userAgent ?? null,
          input.ip ?? null,
          input.tokenHash,
        ],
      );
      return rows[0]!;
    },

    async consumeRefreshToken(tokenHash: string): Promise<string | null> {
      const { rows } = await db.query<{ session_id: string }>(
        `UPDATE refresh_tokens SET consumed_at = now()
          WHERE token_hash = $1 AND consumed_at IS NULL
          RETURNING session_id`,
        [tokenHash],
      );
      return rows[0]?.session_id ?? null;
    },

    async findSessionOfConsumedToken(
      tokenHash: string,
    ): Promise<string | null> {
      const { rows } = await db.query<{ session_id: string }>(
        `SELECT session_id FROM refresh_tokens
          WHERE token_hash = $1 AND consumed_at IS NOT NULL`,
        [tokenHash],
      );
      return rows[0]?.session_id ?? null;
    },

    async findLive(id: string): Promise<LiveSession | null> {
      const { rows } = await db.query<{
        id: string;
        expires_at: Date;
        user_id: string;
        name: string;
        email: string;
        role: User["role"];
      }>(
        `SELECT s.id, s.expires_at, u.id AS user_id, u.name, u.email, u.role
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.id = $1
            AND s.revoked_at IS NULL
            AND s.expires_at > now()
            AND u.active`,
        [id],
      );
      const row = rows[0];

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        expires_at: row.expires_at,
        user: {
          id: row.user_id,
          name: row.name,
          email: row.email,
          role: row.role,
        },
      };
    },

    async addRefreshToken(sessionId: string, tokenHash: string): Promise<void> {
      await db.query(
        "INSERT INTO refresh_tokens (token_hash, session_id) VALUES ($1, $2)",
        [tokenHash, sessionId],
      );
    },

    async touch(id: string): Promise<void> {
      await db.query("UPDATE sessions SET last_used_at = now() WHERE id = $1", [
        id,
      ]);
    },

    async revoke(id: string, reason: RevokeReason): Promise<void> {
      await db.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
          WHERE id = $1 AND revoked_at IS NULL`,
        [id, reason],
      );
    },

    async revokeAllForUser(userId: string, reason: "admin"): Promise<number> {
      const result = await db.query(
        `UPDATE sessions SET revoked_at = now(), revoked_reason = $2
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, reason],
      );
      return result.rowCount ?? 0;
    },
  };
}

export type SessionRepository = ReturnType<typeof makeSessionRepository>;
