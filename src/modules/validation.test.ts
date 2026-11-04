import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.ts";
import { authHeaders } from "./auth/testing.ts";
import { resetCatalog } from "../infra/db/testing.ts";

const app = buildApp();

let headers: { authorization: string };

beforeAll(async () => {
  await app.ready();
  headers = await authHeaders(app);
});
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

async function post(url: string, body: object) {
  return (await inject("POST", url, body)).json();
}

async function count(table: string) {
  const { rows } = await app.db.query(
    `SELECT count(*)::int AS n FROM ${table}`,
  );
  return rows[0].n;
}

type Ref = { id: string };

let snacks: Ref;
let burger: Ref;
let bacon: Ref;
let combo: Ref;

beforeEach(async () => {
  await resetCatalog(app.db);
  snacks = await post("/categories", { name: "Lanches" });
  burger = await post("/items", {
    category_id: snacks.id,
    name: "Hambúrguer",
    price_cents: 2500,
  });
  bacon = await post("/addons", { name: "Bacon", price_cents: 500 });
  combo = await post("/combos", {
    name: "Combo Clássico",
    components: [{ item_id: burger.id, quantity: 1 }],
  });
});

function newItem(extra: object) {
  return { category_id: snacks.id, name: "X-Salada", ...extra };
}

function newCombo(extra: object) {
  return {
    name: "Combo Kids",
    components: [{ item_id: burger.id, quantity: 1 }],
    ...extra,
  };
}

describe("money is never coerced into a price", () => {
  for (const value of [null, false, true, "500", [500]]) {
    const label = JSON.stringify(value);

    it(`refuses price_cents ${label} on a new item with 400`, async () => {
      const response = await inject(
        "POST",
        "/items",
        newItem({ price_cents: value }),
      );

      expect(response.statusCode).toBe(400);
      expect(await count("items")).toBe(1);
    });

    it(`refuses price_cents ${label} on an item patch with 400`, async () => {
      const response = await inject("PATCH", `/items/${burger.id}`, {
        price_cents: value,
      });

      expect(response.statusCode).toBe(400);
      expect((await inject("GET", "/items")).json()[0].price_cents).toBe(2500);
    });

    it(`refuses price_cents ${label} on an addon patch with 400`, async () => {
      const response = await inject("PATCH", `/addons/${bacon.id}`, {
        price_cents: value,
      });

      expect(response.statusCode).toBe(400);
      expect((await inject("GET", "/addons")).json()[0].price_cents).toBe(500);
    });

    it(`refuses price_cents ${label} on a new combo with 400`, async () => {
      const response = await inject(
        "POST",
        "/combos",
        newCombo({ price_cents: value }),
      );

      expect(response.statusCode).toBe(400);
      expect(await count("combos")).toBe(1);
    });
  }

  it('refuses a quantity of "2" with 400', async () => {
    const response = await inject("POST", "/combos", {
      name: "Combo Kids",
      components: [{ item_id: burger.id, quantity: "2" }],
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("numbers beyond what the database holds", () => {
  it("refuses a price above the ceiling with 400", async () => {
    const response = await inject(
      "POST",
      "/items",
      newItem({ price_cents: 3_000_000_000 }),
    );

    expect(response.statusCode).toBe(400);
  });

  it("refuses a combo price above the ceiling with 400", async () => {
    const response = await inject("PATCH", `/combos/${combo.id}`, {
      price_cents: 3_000_000_000,
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses a quantity above the ceiling with 400", async () => {
    const response = await inject("POST", "/combos", {
      name: "Combo Kids",
      components: [{ item_id: burger.id, quantity: 3_000_000_000 }],
    });

    expect(response.statusCode).toBe(400);
  });

  it("refuses a sort_order beyond an integer with 400", async () => {
    const response = await inject("POST", "/categories", {
      name: "Bebidas",
      sort_order: 99_999_999_999,
    });

    expect(response.statusCode).toBe(400);
  });

  it("answers 422 when the suggested price would exceed the ceiling", async () => {
    const pricey = await post("/items", newItem({ price_cents: 10_000_000 }));

    const response = await inject("POST", "/combos", {
      name: "Combo Banquete",
      components: [{ item_id: pricey.id, quantity: 99 }],
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("SUGGESTED_PRICE_TOO_HIGH");
    expect(response.json().message).toContain("price_cents");
    expect(await count("combos")).toBe(1);
  });

  it("accepts that same combo with a price set by hand", async () => {
    const pricey = await post("/items", newItem({ price_cents: 10_000_000 }));

    const response = await inject("POST", "/combos", {
      name: "Combo Banquete",
      price_cents: 50_000_000,
      components: [{ item_id: pricey.id, quantity: 99 }],
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().suggested_price_cents).toBe(990_000_000);
  });
});

describe("ids are plain lowercase uuids", () => {
  it("answers 400 for a urn:uuid path id", async () => {
    const response = await inject("PATCH", `/items/urn:uuid:${burger.id}`, {
      price_cents: 1,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).not.toContain("invalid input syntax");
  });

  for (const route of ["categories", "addons", "combos"]) {
    it(`answers 400 for a urn:uuid id on /${route}`, async () => {
      const response = await inject(
        "DELETE",
        `/${route}/urn:uuid:${burger.id}`,
      );

      expect(response.statusCode).toBe(400);
    });
  }

  it("answers 400 for a urn:uuid addon id", async () => {
    const response = await inject("PATCH", `/items/${burger.id}`, {
      addon_ids: [`urn:uuid:${bacon.id}`],
    });

    expect(response.statusCode).toBe(400);
  });

  it("answers 400 for an uppercase item id in a combo", async () => {
    const response = await inject("POST", "/combos", {
      name: "Combo Kids",
      components: [{ item_id: burger.id.toUpperCase(), quantity: 1 }],
    });

    expect(response.statusCode).toBe(400);
  });

  it("answers 400 for the same addon id in two cases", async () => {
    const response = await inject("PATCH", `/items/${burger.id}`, {
      addon_ids: [bacon.id, bacon.id.toUpperCase()],
    });

    expect(response.statusCode).toBe(400);
  });

  it("answers 400 for an uppercase swap category id", async () => {
    const response = await inject("POST", "/combos", {
      name: "Combo Kids",
      components: [
        {
          item_id: burger.id,
          quantity: 1,
          swap_category_id: snacks.id.toUpperCase(),
        },
      ],
    });

    expect(response.statusCode).toBe(400);
  });
});
