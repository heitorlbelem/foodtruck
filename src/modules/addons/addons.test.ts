import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.ts";
import { resetCatalog } from "../../infra/db/testing.ts";

const app = buildApp();

beforeAll(() => app.ready());
beforeEach(() => resetCatalog(app.db));
afterAll(() => app.close());

function inject(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) {
  return app.inject({ method, url, ...(payload ? { payload } : {}) });
}

async function createAddon(name: string, price_cents: number) {
  return (await inject("POST", "/addons", { name, price_cents })).json();
}

async function countAddons() {
  const { rows } = await app.db.query("SELECT count(*)::int AS n FROM addons");
  return rows[0].n;
}

describe("addons", () => {
  it("creates an addon with its own price", async () => {
    const response = await inject("POST", "/addons", {
      name: "Bacon",
      price_cents: 500,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      name: "Bacon",
      price_cents: 500,
    });
  });

  it("lists live addons by name", async () => {
    await createAddon("Ovo", 300);
    await createAddon("Bacon", 500);

    const response = await inject("GET", "/addons");

    expect(response.statusCode).toBe(200);
    expect(
      response.json().map((addon: { name: string }) => addon.name),
    ).toEqual(["Bacon", "Ovo"]);
  });

  it("refuses a fractional price with 400", async () => {
    const response = await inject("POST", "/addons", {
      name: "Bacon",
      price_cents: 10.5,
    });

    expect(response.statusCode).toBe(400);
    expect(await countAddons()).toBe(0);
  });

  it("refuses a negative price with 400", async () => {
    const response = await inject("POST", "/addons", {
      name: "Bacon",
      price_cents: -1,
    });

    expect(response.statusCode).toBe(400);
    expect(await countAddons()).toBe(0);
  });

  it("refuses a fractional price on patch with 400", async () => {
    const bacon = await createAddon("Bacon", 500);

    const response = await inject("PATCH", `/addons/${bacon.id}`, {
      price_cents: 5.5,
    });

    expect(response.statusCode).toBe(400);
    expect((await inject("GET", "/addons")).json()[0].price_cents).toBe(500);
  });

  it("refuses a duplicate addon name with 409", async () => {
    await createAddon("Bacon", 500);

    const response = await inject("POST", "/addons", {
      name: "Bacon",
      price_cents: 600,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("Bacon");
    expect(await countAddons()).toBe(1);
  });

  it("refuses a rename onto an existing addon name with 409", async () => {
    await createAddon("Bacon", 500);
    const egg = await createAddon("Ovo", 300);

    const response = await inject("PATCH", `/addons/${egg.id}`, {
      name: "Bacon",
    });

    expect(response.statusCode).toBe(409);
  });

  it("is a separate catalog from items", async () => {
    const category = (
      await inject("POST", "/categories", { name: "Porções" })
    ).json();

    const addon = await inject("POST", "/addons", {
      name: "Cebola crispy",
      price_cents: 400,
    });
    const item = await inject("POST", "/items", {
      category_id: category.id,
      name: "Porção de cebola crispy",
      price_cents: 1800,
    });

    expect(addon.statusCode).toBe(201);
    expect(item.statusCode).toBe(201);
    expect(
      (await inject("GET", "/addons"))
        .json()
        .map((a: { name: string }) => a.name),
    ).toEqual(["Cebola crispy"]);
    expect(
      (await inject("GET", "/items"))
        .json()
        .map((i: { name: string }) => i.name),
    ).toEqual(["Porção de cebola crispy"]);
  });

  it("changes the price of an addon", async () => {
    const bacon = await createAddon("Bacon", 500);

    const response = await inject("PATCH", `/addons/${bacon.id}`, {
      price_cents: 700,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: bacon.id,
      name: "Bacon",
      price_cents: 700,
    });
  });

  it("answers 400 for an id that is not a uuid", async () => {
    const response = await inject("PATCH", "/addons/abc", { price_cents: 1 });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).not.toContain("invalid input syntax");
  });

  it("answers 404 when changing an addon that does not exist", async () => {
    const response = await inject("PATCH", `/addons/${randomUUID()}`, {
      price_cents: 1,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe("addon not found");
  });

  it("archives an addon instead of deleting it", async () => {
    const bacon = await createAddon("Bacon", 500);

    const response = await inject("DELETE", `/addons/${bacon.id}`);

    expect(response.statusCode).toBe(204);
    expect((await inject("GET", "/addons")).json()).toEqual([]);
    expect(await countAddons()).toBe(1);
  });

  it("answers 404 when archiving an addon that does not exist", async () => {
    const response = await inject("DELETE", `/addons/${randomUUID()}`);

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe("addon not found");
  });

  it("answers 404 when changing an archived addon", async () => {
    const bacon = await createAddon("Bacon", 500);
    await inject("DELETE", `/addons/${bacon.id}`);

    const response = await inject("PATCH", `/addons/${bacon.id}`, {
      price_cents: 700,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("archiving an addon an item accepts", () => {
  async function setUp() {
    const category = (
      await inject("POST", "/categories", { name: "Lanches" })
    ).json();
    const bacon = await createAddon("Bacon", 500);
    const burger = (
      await inject("POST", "/items", {
        category_id: category.id,
        name: "Hambúrguer",
        price_cents: 2500,
        addon_ids: [bacon.id],
      })
    ).json();

    return { category, bacon, burger };
  }

  it("refuses to archive an addon still linked to an item", async () => {
    const { bacon } = await setUp();

    const response = await inject("DELETE", `/addons/${bacon.id}`);

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("Hambúrguer");
    expect((await inject("GET", "/addons")).json()).toHaveLength(1);
  });

  it("names every live item that accepts the addon", async () => {
    const { category, bacon } = await setUp();
    await inject("POST", "/items", {
      category_id: category.id,
      name: "X-Salada",
      price_cents: 2200,
      addon_ids: [bacon.id],
    });

    const response = await inject("DELETE", `/addons/${bacon.id}`);

    expect(response.json().message).toContain("Hambúrguer");
    expect(response.json().message).toContain("X-Salada");
  });

  it("archives the addon once the item drops it", async () => {
    const { bacon, burger } = await setUp();
    await inject("PATCH", `/items/${burger.id}`, { addon_ids: [] });

    expect((await inject("DELETE", `/addons/${bacon.id}`)).statusCode).toBe(
      204,
    );
  });

  it("archives the addon once the item is archived", async () => {
    const { bacon, burger } = await setUp();
    await inject("DELETE", `/items/${burger.id}`);

    expect((await inject("DELETE", `/addons/${bacon.id}`)).statusCode).toBe(
      204,
    );
  });
});
