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
  return app.inject({ method, url, ...(payload ? { payload } : {}) });
}

async function post(url: string, body: object) {
  return (await inject("POST", url, body)).json();
}

type Ref = { id: string };

let snacks: Ref;
let drinks: Ref;
let desserts: Ref;
let bacon: Ref;
let burger: Ref;
let salad: Ref;
let soda: Ref;
let combo: Ref;

beforeEach(async () => {
  await resetCatalog(app.db);
  snacks = await post("/categories", { name: "Lanches", sort_order: 1 });
  drinks = await post("/categories", { name: "Bebidas", sort_order: 2 });
  desserts = await post("/categories", { name: "Sobremesas", sort_order: 3 });
  bacon = await post("/addons", { name: "Bacon", price_cents: 500 });
  burger = await post("/items", {
    category_id: snacks.id,
    name: "Hambúrguer",
    price_cents: 2500,
    ingredients: ["alface", "tomate"],
    addon_ids: [bacon.id],
  });
  salad = await post("/items", {
    category_id: snacks.id,
    name: "X-Salada",
    price_cents: 2200,
  });
  soda = await post("/items", {
    category_id: drinks.id,
    name: "Refrigerante",
    price_cents: 700,
  });
  const fries = await post("/items", {
    category_id: snacks.id,
    name: "Batata",
    price_cents: 1200,
  });
  combo = await post("/combos", {
    name: "Combo Clássico",
    price_cents: 3900,
    components: [
      { item_id: burger.id, quantity: 1 },
      { item_id: fries.id, quantity: 1 },
      { item_id: soda.id, quantity: 1, swap_category_id: drinks.id },
    ],
  });
});

describe("GET /menu", () => {
  it("returns categories with their items, the addons and the combos in one request", async () => {
    const response = await inject("GET", "/menu");
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(Object.keys(body)).toEqual(["categories", "addons", "combos"]);
    expect(body.categories[0].items[1]).toMatchObject({
      name: "Hambúrguer",
      price_cents: 2500,
      ingredients: ["alface", "tomate"],
      addons: [{ name: "Bacon", price_cents: 500 }],
    });
    expect(body.addons).toEqual([
      { id: bacon.id, name: "Bacon", price_cents: 500 },
    ]);
    expect(body.combos[0]).toMatchObject({
      name: "Combo Clássico",
      price_cents: 3900,
      suggested_price_cents: 4400,
      components: [
        { item_id: burger.id },
        { item_id: expect.any(String) },
        { item_id: soda.id, swap_category_id: drinks.id },
      ],
    });
  });

  it("orders categories as the owner set them and items by name", async () => {
    const body = (await inject("GET", "/menu")).json();

    expect(
      body.categories.map(
        (category: { name: string; items: { name: string }[] }) => [
          category.name,
          category.items.map((item) => item.name),
        ],
      ),
    ).toEqual([
      ["Lanches", ["Batata", "Hambúrguer", "X-Salada"]],
      ["Bebidas", ["Refrigerante"]],
      ["Sobremesas", []],
    ]);
  });

  it("keeps a category with no items in the list", async () => {
    const body = (await inject("GET", "/menu")).json();

    expect(body.categories.at(-1)).toMatchObject({
      id: desserts.id,
      name: "Sobremesas",
      items: [],
    });
  });

  it("leaves archived items, addons and combos out", async () => {
    await inject("DELETE", `/combos/${combo.id}`);
    await inject("PATCH", `/items/${burger.id}`, { addon_ids: [] });
    await inject("DELETE", `/addons/${bacon.id}`);
    await inject("DELETE", `/items/${salad.id}`);

    const raw = (await inject("GET", "/menu")).body;
    const body = JSON.parse(raw);

    expect(body.combos).toEqual([]);
    expect(body.addons).toEqual([]);
    expect(raw).not.toContain("X-Salada");
    expect(raw).not.toContain("Bacon");
    expect(raw).not.toContain("Combo Clássico");
  });
});
