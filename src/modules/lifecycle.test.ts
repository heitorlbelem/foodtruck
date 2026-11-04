import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.ts";
import { resetCatalog } from "../infra/db/testing.ts";

const app = buildApp();

beforeAll(() => app.ready());
afterAll(() => app.close());

function inject(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: object,
) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload ? { payload } : {}),
  });
}

async function post(url: string, body: object) {
  return (await inject("POST", url, body)).json();
}

type Ref = { id: string };

let snacks: Ref;
let drinks: Ref;
let burger: Ref;
let soda: Ref;
let bacon: Ref;

beforeEach(async () => {
  await resetCatalog(app.db);
  snacks = await post("/categories", { name: "Lanches" });
  drinks = await post("/categories", { name: "Bebidas" });
  bacon = await post("/addons", { name: "Bacon", price_cents: 500 });
  burger = await post("/items", {
    category_id: snacks.id,
    name: "Picanha",
    price_cents: 4500,
    ingredients: ["alface"],
    addon_ids: [bacon.id],
  });
  soda = await post("/items", {
    category_id: drinks.id,
    name: "Refrigerante",
    price_cents: 700,
  });
});

describe("restoring an archived item", () => {
  it("brings it back with the same id, ingredients and addons", async () => {
    await inject("DELETE", `/items/${burger.id}`);

    const response = await inject("POST", `/items/${burger.id}/restore`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: burger.id,
      name: "Picanha",
      price_cents: 4500,
      ingredients: ["alface"],
      addons: [{ id: bacon.id }],
    });
    expect(
      (await inject("GET", "/items")).json().map((i: Ref) => i.id),
    ).toContain(burger.id);
  });

  it("points a 409 on an archived name at the restore", async () => {
    await inject("DELETE", `/items/${burger.id}`);

    const response = await inject("POST", "/items", {
      category_id: snacks.id,
      name: "Picanha",
      price_cents: 5000,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("archived");
    expect(response.json().message).toContain(
      `POST /api/v1/items/${burger.id}/restore`,
    );
  });

  it("keeps the plain 409 for a live name", async () => {
    const response = await inject("POST", "/items", {
      category_id: snacks.id,
      name: "Picanha",
      price_cents: 5000,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).not.toContain("restore");
  });

  it("answers 409 for an item that is not archived", async () => {
    const response = await inject("POST", `/items/${burger.id}/restore`);

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("not archived");
  });

  it("answers 404 for an unknown item", async () => {
    const response = await inject("POST", `/items/${randomUUID()}/restore`);

    expect(response.statusCode).toBe(404);
  });

  it("refuses while its category is archived, naming it", async () => {
    await inject("DELETE", `/items/${soda.id}`);
    await inject("DELETE", `/categories/${drinks.id}`);

    const response = await inject("POST", `/items/${soda.id}/restore`);

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("Bebidas");
  });
});

describe("restoring an archived addon", () => {
  it("brings it back and points the 409 at it", async () => {
    await inject("PATCH", `/items/${burger.id}`, { addon_ids: [] });
    await inject("DELETE", `/addons/${bacon.id}`);

    const conflict = await inject("POST", "/addons", {
      name: "Bacon",
      price_cents: 600,
    });
    const response = await inject("POST", `/addons/${bacon.id}/restore`);

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().message).toContain(
      `POST /api/v1/addons/${bacon.id}/restore`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: bacon.id,
      name: "Bacon",
      price_cents: 500,
    });
  });

  it("answers 409 for an addon that is not archived", async () => {
    const response = await inject("POST", `/addons/${bacon.id}/restore`);

    expect(response.statusCode).toBe(409);
  });
});

describe("restoring an archived combo", () => {
  async function archivedCombo() {
    const combo = await post("/combos", {
      name: "Combo Picanha",
      components: [
        { item_id: burger.id, quantity: 1 },
        { item_id: soda.id, quantity: 1, swap_category_id: drinks.id },
      ],
    });
    await inject("DELETE", `/combos/${combo.id}`);
    return combo;
  }

  it("brings it back with its price and components", async () => {
    const combo = await archivedCombo();

    const response = await inject("POST", `/combos/${combo.id}/restore`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: combo.id,
      price_cents: 5200,
      components: [{ item_id: burger.id }, { item_id: soda.id }],
    });
  });

  it("points the 409 on its name at the restore", async () => {
    const combo = await archivedCombo();

    const response = await inject("POST", "/combos", {
      name: "Combo Picanha",
      components: [{ item_id: burger.id, quantity: 1 }],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain(
      `POST /api/v1/combos/${combo.id}/restore`,
    );
  });

  it("refuses while a component item is archived, naming it", async () => {
    const combo = await archivedCombo();
    await inject("DELETE", `/items/${soda.id}`);

    const response = await inject("POST", `/combos/${combo.id}/restore`);

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("Refrigerante");
  });

  it("refuses while a swap category is archived, naming it", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    const combo = await post("/combos", {
      name: "Combo Doce",
      components: [
        { item_id: burger.id, quantity: 1, swap_category_id: desserts.id },
      ],
    });
    await inject("DELETE", `/combos/${combo.id}`);
    await inject("DELETE", `/categories/${desserts.id}`);

    const response = await inject("POST", `/combos/${combo.id}/restore`);

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("Sobremesas");
  });
});

describe("archiving a category", () => {
  it("leaves it out of /categories and /menu", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });

    await inject("DELETE", `/categories/${desserts.id}`);

    expect(
      (await inject("GET", "/categories")).json().map((c: Ref) => c.id),
    ).not.toContain(desserts.id);
    expect((await inject("GET", "/menu")).body).not.toContain("Sobremesas");
  });

  it("names both the live items and the live combos holding it", async () => {
    await post("/combos", {
      name: "Combo Picanha",
      components: [
        { item_id: burger.id, quantity: 1, swap_category_id: snacks.id },
      ],
    });

    const response = await inject("DELETE", `/categories/${snacks.id}`);

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("Picanha");
    expect(response.json().message).toContain("Combo Picanha");
  });

  it("refuses a new item in an archived category with 422", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    const response = await inject("POST", "/items", {
      category_id: desserts.id,
      name: "Pudim",
      price_cents: 900,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain(desserts.id);
  });

  it("refuses moving an item into an archived category with 422", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    const response = await inject("PATCH", `/items/${burger.id}`, {
      category_id: desserts.id,
    });

    expect(response.statusCode).toBe(422);
  });

  it("refuses an archived swap category in a combo with 422", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    const response = await inject("POST", "/combos", {
      name: "Combo Doce",
      components: [
        { item_id: burger.id, quantity: 1, swap_category_id: desserts.id },
      ],
    });

    expect(response.statusCode).toBe(422);
  });

  it("answers 404 when renaming an archived category", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    const response = await inject("PATCH", `/categories/${desserts.id}`, {
      name: "Doces",
    });

    expect(response.statusCode).toBe(404);
  });

  it("answers 404 when archiving it twice", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    expect(
      (await inject("DELETE", `/categories/${desserts.id}`)).statusCode,
    ).toBe(404);
  });

  it("restores it, and points the 409 on its name at the restore", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    const conflict = await inject("POST", "/categories", {
      name: "Sobremesas",
    });
    const response = await inject("POST", `/categories/${desserts.id}/restore`);

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().message).toContain(
      `POST /api/v1/categories/${desserts.id}/restore`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: desserts.id,
      name: "Sobremesas",
    });
  });
});

describe("restore paths are validated", () => {
  for (const route of ["items", "addons", "combos", "categories"]) {
    it(`answers 400 for a non-uuid id on /${route}/:id/restore`, async () => {
      expect((await inject("POST", `/${route}/abc/restore`)).statusCode).toBe(
        400,
      );
    });
  }
});
