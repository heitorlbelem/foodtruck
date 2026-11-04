import type { Pool } from "pg";

import { withTransaction } from "../../infra/db/transaction.ts";
import { makeSessionRepository } from "../auth/sessions.repository.ts";
import { ROLE_PERMISSIONS } from "../auth/permissions.ts";
import { makeFoodtruckRepository } from "../foodtruck/foodtruck.repository.ts";
import { checkPassword, hashPassword, normalizeEmail } from "./passwords.ts";
import {
  makeUserRepository,
  type Role,
  type User,
} from "./users.repository.ts";

const UNIQUE_VIOLATION = "23505";

async function requireUser(
  repository: ReturnType<typeof makeUserRepository>,
  email: string,
) {
  const user = await repository.findByEmail(email);

  if (!user) {
    throw new Error(`No user with email ${normalizeEmail(email)}`);
  }

  return user;
}

function requirePassword(password: string): void {
  const problem = checkPassword(password);

  if (problem) {
    throw new Error(problem);
  }
}

export async function createUser(
  db: Pool,
  input: { email: string; name: string; password: string; role?: Role },
): Promise<User> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  const role = input.role ?? "owner";

  if (!email.includes("@")) {
    throw new Error("Email must contain @");
  }
  if (!name) {
    throw new Error("Name must not be empty");
  }
  if (!Object.hasOwn(ROLE_PERMISSIONS, role)) {
    throw new Error(
      `Unknown role ${role}; expected one of ${Object.keys(ROLE_PERMISSIONS).join(", ")}`,
    );
  }
  requirePassword(input.password);

  const foodtruckId = await makeFoodtruckRepository(db).currentId();
  const passwordHash = await hashPassword(input.password);

  try {
    return await makeUserRepository(db).create({
      foodtruckId,
      name,
      email,
      passwordHash,
      role,
    });
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new Error(`A user with email ${email} already exists`);
    }
    throw error;
  }
}

export async function resetPassword(
  db: Pool,
  email: string,
  password: string,
): Promise<number> {
  requirePassword(password);
  const user = await requireUser(makeUserRepository(db), email);
  const passwordHash = await hashPassword(password);

  return withTransaction(db, async (tx) => {
    await makeUserRepository(tx).setPassword(user.id, passwordHash);

    return makeSessionRepository(tx).revokeAllForUser(user.id, "admin");
  });
}

export async function revokeSessions(db: Pool, email: string): Promise<number> {
  const user = await requireUser(makeUserRepository(db), email);

  return makeSessionRepository(db).revokeAllForUser(user.id, "admin");
}

export async function setUserActive(
  db: Pool,
  email: string,
  active: boolean,
): Promise<void> {
  const user = await requireUser(makeUserRepository(db), email);

  await withTransaction(db, async (tx) => {
    await makeUserRepository(tx).setActive(user.id, active);

    if (!active) {
      await makeSessionRepository(tx).revokeAllForUser(user.id, "admin");
    }
  });
}

export async function listUsers(
  db: Pool,
): Promise<(User & { live_sessions: number })[]> {
  const { rows } = await db.query<User & { live_sessions: number }>(
    `SELECT u.id, u.foodtruck_id, u.name, u.email, u.role, u.active,
            count(s.id)::int AS live_sessions
       FROM users u
       LEFT JOIN sessions s
              ON s.user_id = u.id
             AND s.revoked_at IS NULL
             AND s.expires_at > now()
      GROUP BY u.id
      ORDER BY u.created_at, u.id`,
  );

  return rows;
}
