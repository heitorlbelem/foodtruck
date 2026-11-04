import { afterAll, describe, expect, it } from "vitest";

import { createPool } from "../infra/db/pool.ts";
import { currentFoodtruckId } from "./foodtruck.ts";

const db = createPool();

afterAll(() => db.end());

describe("currentFoodtruckId", () => {
  it("returns the id of the single seeded foodtruck", async () => {
    const id = await currentFoodtruckId(db);
    const { rows } = await db.query("SELECT id FROM foodtrucks");

    expect(rows).toHaveLength(1);
    expect(id).toBe(rows[0].id);
  });

  it("is stable across calls", async () => {
    expect(await currentFoodtruckId(db)).toBe(await currentFoodtruckId(db));
  });
});
