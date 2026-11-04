import type { Queryable } from "../../infra/db/pool.ts";

export function makeFoodtruckRepository(db: Queryable) {
  return {
    async currentId(): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        "SELECT id FROM foodtrucks LIMIT 2",
      );

      if (rows.length !== 1) {
        throw new Error("expected exactly one foodtruck");
      }

      return rows[0]!.id;
    },
  };
}

export type FoodtruckRepository = ReturnType<typeof makeFoodtruckRepository>;
