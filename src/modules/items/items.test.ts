import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.ts";
import { authHeaders } from "../auth/testing.ts";
import { resetCatalog } from "../../infra/db/testing.ts";

const app = buildApp();

let headers: { authorization: string };

beforeAll(async () => {
  await app.ready();
  headers = await authHeaders(app);
});
beforeEach(() => resetCatalog(app.db));
afterAll(() => app.close());

function inject(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) {
  return app.inject({
    headers,
    method,
    url: `/api/v1${url}`,
    ...(payload ? { payload } : {}),
  });
}

async function createCategory(name: string) {
  return (await inject("POST", "/categories", { name })).json();
}

async function createItem(body: object) {
  return (await inject("POST", "/items", body)).json();
}

async function countIngredients(itemId: string) {
  const { rows } = await app.db.query(
    "SELECT count(*)::int AS n FROM item_ingredients WHERE item_id = $1",
    [itemId],
  );
  return rows[0].n;
}

async function countItems() {
  const { rows } = await app.db.query("SELECT count(*)::int AS n FROM items");
  return rows[0].n;
}

describe("items", () => {
  it("creates an item with a price in cents", async () => {
    const category = await createCategory("Lanches");
    const response = await inject("POST", "/items", {
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
      ingredients: [],
      addons: [],
    });
  });

  it("lists live items by name", async () => {
    const category = await createCategory("Lanches");
    await createItem({
      category_id: category.id,
      name: "X-Salada",
      price_cents: 2200,
    });
    await createItem({
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });

    const names = (await inject("GET", "/items"))
      .json()
      .map((item: { name: string }) => item.name);

    expect(names).toEqual(["Hambúrguer", "X-Salada"]);
  });

  it("refuses a fractional price with 400", async () => {
    const category = await createCategory("Lanches");
    const response = await inject("POST", "/items", {
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 10.5,
    });

    expect(response.statusCode).toBe(400);
    expect(await countItems()).toBe(0);
  });

  it("refuses a negative price with 400", async () => {
    const category = await createCategory("Lanches");
    const response = await inject("POST", "/items", {
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: -1,
    });

    expect(response.statusCode).toBe(400);
    expect(await countItems()).toBe(0);
  });

  it("refuses a fractional price on patch with 400", async () => {
    const category = await createCategory("Lanches");
    const item = await createItem({
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });

    const response = await inject("PATCH", `/items/${item.id}`, {
      price_cents: 10.5,
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses a duplicate item name with 409", async () => {
    const category = await createCategory("Lanches");
    const body = {
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    };
    await inject("POST", "/items", body);

    const response = await inject("POST", "/items", body);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("NAME_TAKEN");
    expect(response.json().message).toContain("Hambúrguer");
    expect(await countItems()).toBe(1);
  });

  it("refuses an unknown category with 422", async () => {
    const response = await inject("POST", "/items", {
      category_id: randomUUID(),
      name: "Hambúrguer",
      price_cents: 2500,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("INVALID_REFERENCE");
    expect(await countItems()).toBe(0);
  });

  it("answers 400 for an id that is not a uuid", async () => {
    const response = await inject("PATCH", "/items/abc", { price_cents: 1 });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).not.toContain("invalid input syntax");
  });

  it("changes the price of an item", async () => {
    const category = await createCategory("Lanches");
    const item = await createItem({
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });

    const response = await inject("PATCH", `/items/${item.id}`, {
      price_cents: 2800,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Hambúrguer",
      price_cents: 2800,
    });
  });

  it("moves an item to an unknown category with 422", async () => {
    const category = await createCategory("Lanches");
    const item = await createItem({
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });

    const response = await inject("PATCH", `/items/${item.id}`, {
      category_id: randomUUID(),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("INVALID_REFERENCE");
  });

  it("answers 404 when changing an item that does not exist", async () => {
    const response = await inject("PATCH", `/items/${randomUUID()}`, {
      price_cents: 2800,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("ITEM_NOT_FOUND");
    expect(response.json().message).toBe("item not found");
  });

  it("archives an item instead of deleting it", async () => {
    const category = await createCategory("Lanches");
    const item = await createItem({
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });

    const response = await inject("DELETE", `/items/${item.id}`);

    expect(response.statusCode).toBe(204);
    expect((await inject("GET", "/items")).json()).toEqual([]);
    const { rows } = await app.db.query(
      "SELECT archived_at FROM items WHERE id = $1",
      [item.id],
    );
    expect(rows[0].archived_at).not.toBeNull();
  });

  it("answers 404 when archiving an item that does not exist", async () => {
    const response = await inject("DELETE", `/items/${randomUUID()}`);

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("ITEM_NOT_FOUND");
    expect(response.json().message).toBe("item not found");
  });

  it("answers 404 when changing an archived item", async () => {
    const category = await createCategory("Lanches");
    const item = await createItem({
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });
    await inject("DELETE", `/items/${item.id}`);

    const response = await inject("PATCH", `/items/${item.id}`, {
      price_cents: 2800,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("ITEM_NOT_FOUND");
    expect(response.json().message).toBe("item not found");
  });
});

describe("archiving a category that holds items", () => {
  it("refuses with 409 naming the category", async () => {
    const category = await createCategory("Lanches");
    await createItem({
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });

    const response = await inject("DELETE", `/categories/${category.id}`);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("IN_USE");
    expect(response.json().message).toContain("Lanches");
    expect(response.json().message).toContain("Hambúrguer");
  });

  it("archives it once its only items are archived", async () => {
    const category = await createCategory("Lanches");
    const item = await createItem({
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });
    await inject("DELETE", `/items/${item.id}`);

    const response = await inject("DELETE", `/categories/${category.id}`);

    expect(response.statusCode).toBe(204);
  });
});

describe("removable ingredients", () => {
  async function createBurger(ingredients?: string[]) {
    const category = await createCategory("Lanches");
    return createItem({
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
      ...(ingredients ? { ingredients } : {}),
    });
  }

  it("creates an item with its removable ingredients", async () => {
    const category = await createCategory("Lanches");
    const response = await inject("POST", "/items", {
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
      ingredients: ["alface", "tomate", "cebola"],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().ingredients).toEqual(["alface", "tomate", "cebola"]);
  });

  it("keeps the ingredient order the owner typed", async () => {
    await createBurger(["alface", "tomate", "cebola"]);

    const items = (await inject("GET", "/items")).json();

    expect(items[0].ingredients).toEqual(["alface", "tomate", "cebola"]);
  });

  it("returns an empty list for an item without ingredients", async () => {
    await createBurger();

    const items = (await inject("GET", "/items")).json();

    expect(items[0].ingredients).toEqual([]);
  });

  it("replaces the whole ingredient list on patch", async () => {
    const item = await createBurger(["alface", "tomate", "cebola"]);

    const response = await inject("PATCH", `/items/${item.id}`, {
      ingredients: ["alface"],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ingredients).toEqual(["alface"]);
    expect(await countIngredients(item.id)).toBe(1);
  });

  it("clears the ingredient list on patch with an empty array", async () => {
    const item = await createBurger(["alface", "tomate"]);

    const response = await inject("PATCH", `/items/${item.id}`, {
      ingredients: [],
    });

    expect(response.json().ingredients).toEqual([]);
    expect(await countIngredients(item.id)).toBe(0);
  });

  it("keeps the ingredient list on a patch that omits it", async () => {
    const item = await createBurger(["alface", "tomate"]);

    const response = await inject("PATCH", `/items/${item.id}`, {
      price_cents: 2800,
    });

    expect(response.json()).toMatchObject({
      price_cents: 2800,
      ingredients: ["alface", "tomate"],
    });
  });

  it("refuses the same ingredient twice in one item with 400", async () => {
    const category = await createCategory("Lanches");
    const response = await inject("POST", "/items", {
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
      ingredients: ["alface", "alface"],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("ingredients");
    expect(await countItems()).toBe(0);
  });

  it("refuses an empty ingredient name with 400", async () => {
    const category = await createCategory("Lanches");
    const response = await inject("POST", "/items", {
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
      ingredients: [""],
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("ingredients");
    expect(await countItems()).toBe(0);
  });

  it("drops the ingredients of an item that is deleted from the database", async () => {
    const item = await createBurger(["alface"]);

    await app.db.query("DELETE FROM items WHERE id = $1", [item.id]);

    expect(await countIngredients(item.id)).toBe(0);
  });
});

describe("addons an item accepts", () => {
  async function createAddon(name: string, price_cents: number) {
    return (await inject("POST", "/addons", { name, price_cents })).json();
  }

  async function burgerBody(addon_ids?: string[]) {
    const category = await createCategory("Lanches");
    return {
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
      ...(addon_ids ? { addon_ids } : {}),
    };
  }

  it("declares which addons an item accepts", async () => {
    const bacon = await createAddon("Bacon", 500);

    const response = await inject(
      "POST",
      "/items",
      await burgerBody([bacon.id]),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().addons).toEqual([
      { id: bacon.id, name: "Bacon", price_cents: 500 },
    ]);
  });

  it("lists the accepted addons by name", async () => {
    const egg = await createAddon("Ovo", 300);
    const bacon = await createAddon("Bacon", 500);
    await createItem(await burgerBody([egg.id, bacon.id]));

    const items = (await inject("GET", "/items")).json();

    expect(items[0].addons.map((a: { name: string }) => a.name)).toEqual([
      "Bacon",
      "Ovo",
    ]);
  });

  it("shows the addon's current price", async () => {
    const bacon = await createAddon("Bacon", 500);
    await createItem(await burgerBody([bacon.id]));
    await inject("PATCH", `/addons/${bacon.id}`, { price_cents: 700 });

    const items = (await inject("GET", "/items")).json();

    expect(items[0].addons[0].price_cents).toBe(700);
  });

  it("refuses an unknown addon id with 422", async () => {
    const unknown = randomUUID();

    const response = await inject(
      "POST",
      "/items",
      await burgerBody([unknown]),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("INVALID_REFERENCE");
    expect(response.json().message).toContain(unknown);
    expect(await countItems()).toBe(0);
  });

  it("refuses an archived addon with 422", async () => {
    const bacon = await createAddon("Bacon", 500);
    await inject("DELETE", `/addons/${bacon.id}`);

    const response = await inject(
      "POST",
      "/items",
      await burgerBody([bacon.id]),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("INVALID_REFERENCE");
    expect(response.json().message).toContain(bacon.id);
    expect(await countItems()).toBe(0);
  });

  it("names only the offending ids", async () => {
    const bacon = await createAddon("Bacon", 500);
    const unknown = randomUUID();

    const response = await inject(
      "POST",
      "/items",
      await burgerBody([bacon.id, unknown]),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("INVALID_REFERENCE");
    expect(response.json().message).toContain(unknown);
    expect(response.json().message).not.toContain(bacon.id);
  });

  it("refuses the same addon twice with 400", async () => {
    const bacon = await createAddon("Bacon", 500);

    const response = await inject(
      "POST",
      "/items",
      await burgerBody([bacon.id, bacon.id]),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("addon_ids");
  });

  it("refuses an addon id that is not a uuid with 400", async () => {
    const response = await inject("POST", "/items", await burgerBody(["abc"]));

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("addon_ids");
  });

  it("replaces the whole addon list on patch", async () => {
    const bacon = await createAddon("Bacon", 500);
    const egg = await createAddon("Ovo", 300);
    const item = await createItem(await burgerBody([bacon.id]));

    const response = await inject("PATCH", `/items/${item.id}`, {
      addon_ids: [egg.id],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().addons).toEqual([
      { id: egg.id, name: "Ovo", price_cents: 300 },
    ]);
  });

  it("clears the addon list on patch with an empty array", async () => {
    const bacon = await createAddon("Bacon", 500);
    const item = await createItem(await burgerBody([bacon.id]));

    const response = await inject("PATCH", `/items/${item.id}`, {
      addon_ids: [],
    });

    expect(response.json().addons).toEqual([]);
  });

  it("keeps the addon list on a patch that omits it", async () => {
    const bacon = await createAddon("Bacon", 500);
    const item = await createItem(await burgerBody([bacon.id]));

    const response = await inject("PATCH", `/items/${item.id}`, {
      price_cents: 2800,
    });

    expect(response.json().addons).toEqual([
      { id: bacon.id, name: "Bacon", price_cents: 500 },
    ]);
  });

  it("leaves the item untouched when a patch names an unknown addon", async () => {
    const bacon = await createAddon("Bacon", 500);
    const item = await createItem(await burgerBody([bacon.id]));

    const response = await inject("PATCH", `/items/${item.id}`, {
      price_cents: 2800,
      addon_ids: [randomUUID()],
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("INVALID_REFERENCE");
    expect((await inject("GET", "/items")).json()[0]).toMatchObject({
      price_cents: 2500,
      addons: [{ id: bacon.id }],
    });
  });

  it("leaves an archived addon out of the item", async () => {
    const bacon = await createAddon("Bacon", 500);
    await createItem(await burgerBody([bacon.id]));
    await app.db.query("UPDATE addons SET archived_at = now() WHERE id = $1", [
      bacon.id,
    ]);

    const items = (await inject("GET", "/items")).json();

    expect(items[0].addons).toEqual([]);
  });
});

describe("archiving an item a combo depends on", () => {
  async function setUp() {
    const snacks = await createCategory("Lanches");
    const drinks = await createCategory("Bebidas");
    const burger = await createItem({
      category_id: snacks.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });
    const soda = await createItem({
      category_id: drinks.id,
      name: "Refrigerante",
      price_cents: 700,
    });
    const combo = (
      await inject("POST", "/combos", {
        name: "Combo Clássico",
        components: [
          { item_id: burger.id, quantity: 1 },
          { item_id: soda.id, quantity: 1, swap_category_id: drinks.id },
        ],
      })
    ).json();

    return { burger, soda, combo };
  }

  it("refuses to archive an item that is a component of an active combo", async () => {
    const { soda } = await setUp();

    const response = await inject("DELETE", `/items/${soda.id}`);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("IN_USE");
    expect(response.json().message).toContain("Combo Clássico");
    expect((await inject("GET", "/items")).json()).toHaveLength(2);
  });

  it("names every active combo holding the item", async () => {
    const { burger, soda } = await setUp();
    await inject("POST", "/combos", {
      name: "Combo Kids",
      components: [
        { item_id: burger.id, quantity: 1 },
        { item_id: soda.id, quantity: 1 },
      ],
    });

    const response = await inject("DELETE", `/items/${soda.id}`);

    expect(response.json().message).toContain("Combo Clássico");
    expect(response.json().message).toContain("Combo Kids");
  });

  it("archives the item once the combo is archived", async () => {
    const { soda, combo } = await setUp();
    await inject("DELETE", `/combos/${combo.id}`);

    expect((await inject("DELETE", `/items/${soda.id}`)).statusCode).toBe(204);
  });

  it("archives the item once the combo drops it", async () => {
    const { burger, soda, combo } = await setUp();
    await inject("PATCH", `/combos/${combo.id}`, {
      components: [{ item_id: burger.id, quantity: 1 }],
    });

    expect((await inject("DELETE", `/items/${soda.id}`)).statusCode).toBe(204);
  });
});
