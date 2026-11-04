import type { Pool } from "pg";

import { withTransaction } from "../../infra/db/transaction.ts";
import { AppError } from "../../shared/errors.ts";
import { verifyAgainstDummy, verifyPassword } from "../users/passwords.ts";
import { makeUserRepository, type User } from "../users/users.repository.ts";
import { makeSessionRepository } from "./sessions.repository.ts";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  hashRefreshToken,
  newRefreshToken,
  signAccessToken,
} from "./tokens.ts";

export type TokenPair = {
  access_token: string;
  token_type: "Bearer";
  expires_in: typeof ACCESS_TOKEN_TTL_SECONDS;
  refresh_token: string;
  refresh_expires_at: string;
  user: Pick<User, "id" | "name" | "email" | "role">;
};

function invalidCredentials(): AppError {
  return new AppError(401, "INVALID_CREDENTIALS", "invalid email or password");
}

function invalidRefreshToken(): AppError {
  return new AppError(401, "INVALID_REFRESH_TOKEN", "invalid refresh token");
}

export function makeAuthService({
  db,
  secret,
}: {
  db: Pool;
  secret: Uint8Array;
}) {
  async function pair(
    session: { id: string; expires_at: Date },
    user: TokenPair["user"],
    refreshToken: string,
  ): Promise<TokenPair> {
    return {
      access_token: await signAccessToken(secret, {
        sub: user.id,
        sid: session.id,
        role: user.role,
      }),
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      refresh_expires_at: session.expires_at.toISOString(),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  return {
    async login(
      email: string,
      password: string,
      meta: { userAgent?: string; ip?: string },
    ): Promise<TokenPair> {
      const user = await makeUserRepository(db).findByEmail(email);

      if (!user) {
        await verifyAgainstDummy(password);
        throw invalidCredentials();
      }

      if (!(await verifyPassword(user.password_hash, password))) {
        throw invalidCredentials();
      }

      if (!user.active) {
        throw invalidCredentials();
      }

      const refreshToken = newRefreshToken();
      const session = await makeSessionRepository(db).create({
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        ...meta,
      });

      return pair(session, user, refreshToken);
    },

    async refresh(refreshToken: string): Promise<TokenPair> {
      const tokenHash = hashRefreshToken(refreshToken);

      const rotated = await withTransaction(db, async (tx) => {
        const sessions = makeSessionRepository(tx);
        const sessionId = await sessions.consumeRefreshToken(tokenHash);

        if (!sessionId) {
          const reused = await sessions.findSessionOfConsumedToken(tokenHash);
          if (reused) {
            await sessions.revoke(reused, "reuse");
          }
          return null;
        }

        const session = await sessions.findLive(sessionId);

        if (!session) {
          throw invalidRefreshToken();
        }

        const next = newRefreshToken();
        await sessions.addRefreshToken(session.id, hashRefreshToken(next));
        await sessions.touch(session.id);

        return { session, next };
      });

      if (!rotated) {
        throw invalidRefreshToken();
      }

      return pair(rotated.session, rotated.session.user, rotated.next);
    },

    async logout(sessionId: string): Promise<void> {
      await makeSessionRepository(db).revoke(sessionId, "logout");
    },
  };
}

export type AuthService = ReturnType<typeof makeAuthService>;
