import type { Queryable } from "../../infra/db/pool.ts";
import type { ListFilter } from "../../shared/api.ts";

export type Category = { id: string; name: string; sort_order: number };

type CategoryLock = {
  id: string;
  name: string;
  archived: boolean;
  foodtruck_id: string;
};

const COLUMNS = "id, name, sort_order";

export function makeCategoryRepository(db: Queryable) {
  return {
    async list(
      foodtruckId: string,
      { archived }: ListFilter = { archived: false },
    ): Promise<Category[]> {
      const { rows } = await db.query<Category>(
        `SELECT ${COLUMNS} FROM categories
          WHERE foodtruck_id = $1 AND (archived_at IS NOT NULL) = $2
          ORDER BY sort_order, name`,
        [foodtruckId, archived],
      );

      return rows;
    },

    async create(
      foodtruckId: string,
      input: { name: string; sort_order?: number },
    ): Promise<Category> {
      const { rows } = await db.query<Category>(
        `INSERT INTO categories (foodtruck_id, name, sort_order)
         VALUES ($1, $2, coalesce($3, 0))
         RETURNING ${COLUMNS}`,
        [foodtruckId, input.name, input.sort_order ?? null],
      );

      return rows[0]!;
    },

    async update(
      id: string,
      input: { name?: string; sort_order?: number },
    ): Promise<Category | undefined> {
      const { rows } = await db.query<Category>(
        `UPDATE categories
            SET name = coalesce($2, name),
                sort_order = coalesce($3, sort_order),
                updated_at = now()
          WHERE id = $1 AND archived_at IS NULL
          RETURNING ${COLUMNS}`,
        [id, input.name ?? null, input.sort_order ?? null],
      );

      return rows[0];
    },

    async lock(
      id: string,
    ): Promise<{ name: string; archived: boolean } | undefined> {
      const { rows } = await db.query<{ name: string; archived: boolean }>(
        `SELECT name, archived_at IS NOT NULL AS archived FROM categories
          WHERE id = $1
            FOR UPDATE`,
        [id],
      );

      return rows[0];
    },

    async lockShared(id: string): Promise<CategoryLock | undefined> {
      const { rows } = await db.query<CategoryLock>(
        `SELECT id, name, archived_at IS NOT NULL AS archived, foodtruck_id
           FROM categories
          WHERE id = $1
            FOR SHARE`,
        [id],
      );

      return rows[0];
    },

    async lockSharedMany(ids: string[]): Promise<CategoryLock[]> {
      const { rows } = await db.query<CategoryLock>(
        `SELECT id, name, archived_at IS NOT NULL AS archived, foodtruck_id
           FROM categories
          WHERE id = ANY($1::uuid[])
            FOR SHARE`,
        [ids],
      );

      return rows;
    },

    async archive(id: string): Promise<void> {
      await db.query(
        `UPDATE categories
            SET archived_at = now(), updated_at = now()
          WHERE id = $1`,
        [id],
      );
    },

    async restore(id: string): Promise<Category> {
      const { rows } = await db.query<Category>(
        `UPDATE categories
            SET archived_at = NULL, updated_at = now()
          WHERE id = $1
          RETURNING ${COLUMNS}`,
        [id],
      );

      return rows[0]!;
    },

    async findArchivedIdByName(
      foodtruckId: string,
      name: string,
    ): Promise<string | undefined> {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM categories
          WHERE foodtruck_id = $1 AND name = $2 AND archived_at IS NOT NULL`,
        [foodtruckId, name],
      );

      return rows[0]?.id;
    },
  };
}

export type CategoryRepository = ReturnType<typeof makeCategoryRepository>;
