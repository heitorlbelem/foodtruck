import { afterAll, describe, expect, it } from "vitest";

import { createPool } from "../../infra/db/pool.ts";
import { makeFoodtruckRepository } from "./foodtruck.repository.ts";

const db = createPool();
const foodtrucks = makeFoodtruckRepository(db);

afterAll(() => db.end());

describe("currentId", () => {
  it("returns the id of the single seeded foodtruck", async () => {
    const id = await foodtrucks.currentId();
    const { rows } = await db.query("SELECT id FROM foodtrucks");

    expect(rows).toHaveLength(1);
    expect(id).toBe(rows[0].id);
  });

  it("is stable across calls", async () => {
    expect(await foodtrucks.currentId()).toBe(await foodtrucks.currentId());
  });
});
