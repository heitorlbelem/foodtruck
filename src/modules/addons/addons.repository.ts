import type { Queryable } from "../../infra/db/pool.ts";
import type { ListFilter } from "../../shared/api.ts";

export type Addon = { id: string; name: string; price_cents: number };

export type AddonInput = { name: string; price_cents: number };

const COLUMNS = "id, name, price_cents";

export function makeAddonRepository(db: Queryable) {
  return {
    async list(
      foodtruckId: string,
      { archived }: ListFilter = { archived: false },
    ): Promise<Addon[]> {
      const { rows } = await db.query<Addon>(
        `SELECT ${COLUMNS} FROM addons
          WHERE foodtruck_id = $1 AND (archived_at IS NOT NULL) = $2
          ORDER BY name`,
        [foodtruckId, archived],
      );

      return rows;
    },

    async create(foodtruckId: string, input: AddonInput): Promise<Addon> {
      const { rows } = await db.query<Addon>(
        `INSERT INTO addons (foodtruck_id, name, price_cents)
         VALUES ($1, $2, $3)
         RETURNING ${COLUMNS}`,
        [foodtruckId, input.name, input.price_cents],
      );

      return rows[0]!;
    },

    async update(
      id: string,
      input: Partial<AddonInput>,
    ): Promise<Addon | undefined> {
      const { rows } = await db.query<Addon>(
        `UPDATE addons
            SET name = coalesce($2, name),
                price_cents = coalesce($3, price_cents),
                updated_at = now()
          WHERE id = $1 AND archived_at IS NULL
          RETURNING ${COLUMNS}`,
        [id, input.name ?? null, input.price_cents ?? null],
      );

      return rows[0];
    },

    async lock(id: string): Promise<{ archived: boolean } | undefined> {
      const { rows } = await db.query<{ archived: boolean }>(
        `SELECT archived_at IS NOT NULL AS archived FROM addons
          WHERE id = $1
            FOR UPDATE`,
        [id],
      );

      return rows[0];
    },

    async lockLiveIds(foodtruckId: string, ids: string[]): Promise<string[]> {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM addons
          WHERE id = ANY($1::uuid[])
            AND foodtruck_id = $2
            AND archived_at IS NULL
            FOR SHARE`,
        [ids, foodtruckId],
      );

      return rows.map((row) => row.id);
    },

    async archive(id: string): Promise<void> {
      await db.query(
        `UPDATE addons
            SET archived_at = now(), updated_at = now()
          WHERE id = $1`,
        [id],
      );
    },

    async restore(id: string): Promise<Addon> {
      const { rows } = await db.query<Addon>(
        `UPDATE addons
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
        `SELECT id FROM addons
          WHERE foodtruck_id = $1 AND name = $2 AND archived_at IS NOT NULL`,
        [foodtruckId, name],
      );

      return rows[0]?.id;
    },
  };
}

export type AddonRepository = ReturnType<typeof makeAddonRepository>;
