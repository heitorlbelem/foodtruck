import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.ts";
import { resetCatalog } from "../infra/db/testing.ts";

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
  });

  it("answers 404 when changing an item that does not exist", async () => {
    const response = await inject("PATCH", `/items/${randomUUID()}`, {
      price_cents: 2800,
    });

    expect(response.statusCode).toBe(404);
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
    expect(response.json().message).toBe("item not found");
  });
});

describe("deleting a category that holds items", () => {
  it("refuses with 409 naming the category", async () => {
    const category = await createCategory("Lanches");
    await createItem({
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });

    const response = await inject("DELETE", `/categories/${category.id}`);

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("Lanches");
  });

  it("still refuses when its only items are archived", async () => {
    const category = await createCategory("Lanches");
    const item = await createItem({
      category_id: category.id,
      name: "Hambúrguer",
      price_cents: 2500,
    });
    await inject("DELETE", `/items/${item.id}`);

    const response = await inject("DELETE", `/categories/${category.id}`);

    expect(response.statusCode).toBe(409);
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
