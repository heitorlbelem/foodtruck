import type { Queryable } from "../../infra/db/pool.ts";
import { normalizeEmail } from "./passwords.ts";

export type Role = "owner";

export type User = {
  id: string;
  foodtruck_id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
};

const COLUMNS = "id, foodtruck_id, name, email, role, active";

export function makeUserRepository(db: Queryable) {
  return {
    async create(input: {
      foodtruckId: string;
      name: string;
      email: string;
      passwordHash: string;
      role: Role;
    }): Promise<User> {
      const { rows } = await db.query<User>(
        `INSERT INTO users (foodtruck_id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLUMNS}`,
        [
          input.foodtruckId,
          input.name,
          normalizeEmail(input.email),
          input.passwordHash,
          input.role,
        ],
      );
      return rows[0]!;
    },

    async findByEmail(
      email: string,
    ): Promise<(User & { password_hash: string }) | null> {
      const { rows } = await db.query<User & { password_hash: string }>(
        `SELECT ${COLUMNS}, password_hash FROM users WHERE email = $1`,
        [normalizeEmail(email)],
      );
      return rows[0] ?? null;
    },

    async findById(id: string): Promise<User | null> {
      const { rows } = await db.query<User>(
        `SELECT ${COLUMNS} FROM users WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    },

    async setPassword(id: string, passwordHash: string): Promise<void> {
      await db.query(
        "UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1",
        [id, passwordHash],
      );
    },

    async setActive(id: string, active: boolean): Promise<void> {
      await db.query(
        "UPDATE users SET active = $2, updated_at = now() WHERE id = $1",
        [id, active],
      );
    },

    async list(): Promise<User[]> {
      const { rows } = await db.query<User>(
        `SELECT ${COLUMNS} FROM users ORDER BY created_at, id`,
      );
      return rows;
    },
  };
}

export type UserRepository = ReturnType<typeof makeUserRepository>;
