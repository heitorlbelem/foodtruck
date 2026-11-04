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
  return app.inject({ method, url, ...(payload ? { payload } : {}) });
}

async function post(url: string, body: object) {
  return (await inject("POST", url, body)).json();
}

async function countCombos() {
  const { rows } = await app.db.query("SELECT count(*)::int AS n FROM combos");
  return rows[0].n;
}

type Ref = { id: string };

let snacks: Ref;
let sides: Ref;
let drinks: Ref;
let burger: Ref;
let fries: Ref;
let soda: Ref;

beforeEach(async () => {
  await resetCatalog(app.db);
  snacks = await post("/categories", { name: "Lanches" });
  sides = await post("/categories", { name: "Porções" });
  drinks = await post("/categories", { name: "Bebidas" });
  burger = await post("/items", {
    category_id: snacks.id,
    name: "Hambúrguer",
    price_cents: 2500,
  });
  fries = await post("/items", {
    category_id: sides.id,
    name: "Batata",
    price_cents: 1200,
  });
  soda = await post("/items", {
    category_id: drinks.id,
    name: "Refrigerante",
    price_cents: 700,
  });
});

function classicComponents() {
  return [
    { item_id: burger.id, quantity: 1 },
    { item_id: fries.id, quantity: 1 },
    { item_id: soda.id, quantity: 1, swap_category_id: drinks.id },
  ];
}

function classic(extra: object = {}) {
  return { name: "Combo Clássico", components: classicComponents(), ...extra };
}

describe("combos", () => {
  it("defaults the price to the sum of its components", async () => {
    const response = await inject("POST", "/combos", classic());

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: expect.any(String),
      name: "Combo Clássico",
      price_cents: 4400,
      suggested_price_cents: 4400,
    });
  });

  it("multiplies the suggestion by each component's quantity", async () => {
    const response = await inject("POST", "/combos", {
      name: "Combo Casal",
      components: [
        { item_id: burger.id, quantity: 2 },
        { item_id: soda.id, quantity: 2 },
      ],
    });

    expect(response.json()).toMatchObject({
      price_cents: 6400,
      suggested_price_cents: 6400,
    });
  });

  it("keeps a price the owner set by hand", async () => {
    const response = await inject(
      "POST",
      "/combos",
      classic({ price_cents: 3900 }),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      price_cents: 3900,
      suggested_price_cents: 4400,
    });
  });

  it("never moves a hand-set price when an item gets more expensive", async () => {
    await post("/combos", classic({ price_cents: 3900 }));
    await inject("PATCH", `/items/${burger.id}`, { price_cents: 3000 });

    const combo = (await inject("GET", "/combos")).json()[0];

    expect(combo.price_cents).toBe(3900);
    expect(combo.suggested_price_cents).toBe(4900);
  });

  it("returns the components in the order they were given", async () => {
    const combo = await post("/combos", classic());

    expect(combo.components).toEqual([
      {
        id: expect.any(String),
        item_id: burger.id,
        quantity: 1,
        swap_category_id: null,
      },
      {
        id: expect.any(String),
        item_id: fries.id,
        quantity: 1,
        swap_category_id: null,
      },
      {
        id: expect.any(String),
        item_id: soda.id,
        quantity: 1,
        swap_category_id: drinks.id,
      },
    ]);
  });

  it("records the swap category of a component", async () => {
    await post("/combos", classic());

    const component = (await inject("GET", "/combos")).json()[0].components[2];

    expect(component.swap_category_id).toBe(drinks.id);
  });

  it("allows a component with no swap category", async () => {
    await post("/combos", classic());

    const component = (await inject("GET", "/combos")).json()[0].components[0];

    expect(component.swap_category_id).toBeNull();
  });

  it("lists live combos by name", async () => {
    await post("/combos", classic({ name: "Combo Kids" }));
    await post("/combos", classic());

    const names = (await inject("GET", "/combos"))
      .json()
      .map((combo: { name: string }) => combo.name);

    expect(names).toEqual(["Combo Clássico", "Combo Kids"]);
  });

  it("refuses an unknown item as a component with 422", async () => {
    const unknown = randomUUID();

    const response = await inject("POST", "/combos", {
      name: "Combo Clássico",
      components: [{ item_id: unknown, quantity: 1 }],
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain(unknown);
    expect(await countCombos()).toBe(0);
  });

  it("refuses an archived item as a component with 422", async () => {
    await inject("DELETE", `/items/${fries.id}`);

    const response = await inject("POST", "/combos", classic());

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain(fries.id);
    expect(response.json().message).not.toContain(burger.id);
    expect(await countCombos()).toBe(0);
  });

  it("refuses an unknown swap category with 422", async () => {
    const unknown = randomUUID();

    const response = await inject("POST", "/combos", {
      name: "Combo Clássico",
      components: [
        { item_id: soda.id, quantity: 1, swap_category_id: unknown },
      ],
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().message).toContain(unknown);
    expect(await countCombos()).toBe(0);
  });

  it("refuses a quantity below one with 400", async () => {
    const response = await inject("POST", "/combos", {
      name: "Combo Clássico",
      components: [{ item_id: burger.id, quantity: 0 }],
    });

    expect(response.statusCode).toBe(400);
    expect(await countCombos()).toBe(0);
  });

  it("refuses a fractional quantity with 400", async () => {
    const response = await inject("POST", "/combos", {
      name: "Combo Clássico",
      components: [{ item_id: burger.id, quantity: 1.5 }],
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses a combo with no components with 400", async () => {
    const response = await inject("POST", "/combos", {
      name: "Combo Clássico",
      components: [],
    });

    expect(response.statusCode).toBe(400);
    expect(await countCombos()).toBe(0);
  });

  it("refuses a fractional price with 400", async () => {
    const response = await inject(
      "POST",
      "/combos",
      classic({ price_cents: 39.9 }),
    );

    expect(response.statusCode).toBe(400);
    expect(await countCombos()).toBe(0);
  });

  it("refuses a negative price with 400", async () => {
    const response = await inject(
      "POST",
      "/combos",
      classic({ price_cents: -1 }),
    );

    expect(response.statusCode).toBe(400);
  });

  it("refuses unknown fields in a component with 400", async () => {
    const response = await inject("POST", "/combos", {
      name: "Combo Clássico",
      components: [{ item_id: burger.id, quantity: 1, price_cents: 100 }],
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses a duplicate combo name with 409", async () => {
    await post("/combos", classic());

    const response = await inject("POST", "/combos", classic());

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("Combo Clássico");
    expect(await countCombos()).toBe(1);
  });

  it("replaces the whole component list on patch", async () => {
    const combo = await post("/combos", classic());

    const response = await inject("PATCH", `/combos/${combo.id}`, {
      components: [{ item_id: burger.id, quantity: 2 }],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().components).toEqual([
      {
        id: expect.any(String),
        item_id: burger.id,
        quantity: 2,
        swap_category_id: null,
      },
    ]);
    expect(response.json().suggested_price_cents).toBe(5000);
  });

  it("keeps the stored price when a patch changes only the components", async () => {
    const combo = await post("/combos", classic());

    const response = await inject("PATCH", `/combos/${combo.id}`, {
      components: [{ item_id: burger.id, quantity: 2 }],
    });

    expect(response.json()).toMatchObject({
      price_cents: 4400,
      suggested_price_cents: 5000,
    });
  });

  it("changes the price on patch", async () => {
    const combo = await post("/combos", classic());

    const response = await inject("PATCH", `/combos/${combo.id}`, {
      price_cents: 4000,
    });

    expect(response.json()).toMatchObject({
      price_cents: 4000,
      suggested_price_cents: 4400,
      components: [
        { item_id: burger.id },
        { item_id: fries.id },
        { item_id: soda.id },
      ],
    });
  });

  it("refuses an empty component list on patch with 400", async () => {
    const combo = await post("/combos", classic());

    const response = await inject("PATCH", `/combos/${combo.id}`, {
      components: [],
    });

    expect(response.statusCode).toBe(400);
  });

  it("leaves the combo untouched when a patch names an unknown item", async () => {
    const combo = await post("/combos", classic());

    const response = await inject("PATCH", `/combos/${combo.id}`, {
      price_cents: 3000,
      components: [{ item_id: randomUUID(), quantity: 1 }],
    });

    expect(response.statusCode).toBe(422);
    expect((await inject("GET", "/combos")).json()[0]).toMatchObject({
      price_cents: 4400,
      components: [
        { item_id: burger.id },
        { item_id: fries.id },
        { item_id: soda.id },
      ],
    });
  });

  it("refuses a rename onto an existing combo name with 409", async () => {
    await post("/combos", classic());
    const kids = await post("/combos", classic({ name: "Combo Kids" }));

    const response = await inject("PATCH", `/combos/${kids.id}`, {
      name: "Combo Clássico",
    });

    expect(response.statusCode).toBe(409);
  });

  it("answers 400 for an id that is not a uuid", async () => {
    const response = await inject("PATCH", "/combos/abc", { price_cents: 1 });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).not.toContain("invalid input syntax");
  });

  it("answers 404 when changing a combo that does not exist", async () => {
    const response = await inject("PATCH", `/combos/${randomUUID()}`, {
      price_cents: 1,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe("combo not found");
  });

  it("archives a combo instead of deleting it", async () => {
    const combo = await post("/combos", classic());

    const response = await inject("DELETE", `/combos/${combo.id}`);

    expect(response.statusCode).toBe(204);
    expect((await inject("GET", "/combos")).json()).toEqual([]);
    expect(await countCombos()).toBe(1);
  });

  it("answers 404 when archiving a combo that does not exist", async () => {
    const response = await inject("DELETE", `/combos/${randomUUID()}`);

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe("combo not found");
  });

  it("answers 404 when changing an archived combo", async () => {
    const combo = await post("/combos", classic());
    await inject("DELETE", `/combos/${combo.id}`);

    const response = await inject("PATCH", `/combos/${combo.id}`, {
      price_cents: 1,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe("combo not found");
  });
});

describe("deleting a category that is a swap category", () => {
  it("refuses with 409 naming the category and the combo", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await post("/combos", {
      name: "Combo Clássico",
      components: [
        { item_id: burger.id, quantity: 1, swap_category_id: desserts.id },
      ],
    });

    const response = await inject("DELETE", `/categories/${desserts.id}`);

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("Sobremesas");
    expect(response.json().message).toContain("Combo Clássico");
    expect(response.json().message).not.toContain("items");
  });

  it("still refuses when the only such combo is archived", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    const combo = await post("/combos", {
      name: "Combo Clássico",
      components: [
        { item_id: burger.id, quantity: 1, swap_category_id: desserts.id },
      ],
    });
    await inject("DELETE", `/combos/${combo.id}`);

    const response = await inject("DELETE", `/categories/${desserts.id}`);

    expect(response.statusCode).toBe(409);
  });
});
