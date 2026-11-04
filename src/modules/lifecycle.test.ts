import { randomUUID } from "node:crypto";

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
    expect(response.json().code).toBe("NAME_TAKEN_ARCHIVED");
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
    expect(response.json().code).toBe("NAME_TAKEN");
    expect(response.json().message).not.toContain("restore");
  });

  it("answers 409 for an item that is not archived", async () => {
    const response = await inject("POST", `/items/${burger.id}/restore`);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("NOT_ARCHIVED");
    expect(response.json().message).toContain("not archived");
  });

  it("answers 404 for an unknown item", async () => {
    const response = await inject("POST", `/items/${randomUUID()}/restore`);

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("ITEM_NOT_FOUND");
  });

  it("refuses while its category is archived, naming it", async () => {
    await inject("DELETE", `/items/${soda.id}`);
    await inject("DELETE", `/categories/${drinks.id}`);

    const response = await inject("POST", `/items/${soda.id}/restore`);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("RESTORE_BLOCKED");
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
    expect(conflict.json().code).toBe("NAME_TAKEN_ARCHIVED");
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
    expect(response.json().code).toBe("NOT_ARCHIVED");
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
    expect(response.json().code).toBe("NAME_TAKEN_ARCHIVED");
    expect(response.json().message).toContain(
      `POST /api/v1/combos/${combo.id}/restore`,
    );
  });

  it("refuses while a component item is archived, naming it", async () => {
    const combo = await archivedCombo();
    await inject("DELETE", `/items/${soda.id}`);

    const response = await inject("POST", `/combos/${combo.id}/restore`);

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("RESTORE_BLOCKED");
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
    expect(response.json().code).toBe("RESTORE_BLOCKED");
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
    expect(response.json().code).toBe("IN_USE");
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
    expect(response.json().code).toBe("INVALID_REFERENCE");
    expect(response.json().message).toContain(desserts.id);
  });

  it("refuses moving an item into an archived category with 422", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    const response = await inject("PATCH", `/items/${burger.id}`, {
      category_id: desserts.id,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("INVALID_REFERENCE");
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
    expect(response.json().code).toBe("INVALID_REFERENCE");
  });

  it("answers 404 when renaming an archived category", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    const response = await inject("PATCH", `/categories/${desserts.id}`, {
      name: "Doces",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("CATEGORY_NOT_FOUND");
  });

  it("answers 404 when archiving it twice", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    const response = await inject("DELETE", `/categories/${desserts.id}`);

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("CATEGORY_NOT_FOUND");
  });

  it("restores it, and points the 409 on its name at the restore", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    const conflict = await inject("POST", "/categories", {
      name: "Sobremesas",
    });
    const response = await inject("POST", `/categories/${desserts.id}/restore`);

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("NAME_TAKEN_ARCHIVED");
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

describe("error details", () => {
  async function details(
    method: "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: object,
  ) {
    return (await inject(method, url, payload)).json().details;
  }

  it("names the archived row on a POST onto its name", async () => {
    await inject("DELETE", `/items/${burger.id}`);

    expect(
      await details("POST", "/items", {
        category_id: snacks.id,
        name: "Picanha",
        price_cents: 5000,
      }),
    ).toEqual({ archived_id: burger.id });
  });

  it("names the archived row on a rename onto its name", async () => {
    await inject("DELETE", `/items/${soda.id}`);
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    expect(
      await details("PATCH", `/items/${burger.id}`, { name: "Refrigerante" }),
    ).toEqual({ archived_id: soda.id });
    expect(
      await details("PATCH", `/categories/${snacks.id}`, {
        name: "Sobremesas",
      }),
    ).toEqual({ archived_id: desserts.id });
  });

  it("sends no details for a live name or a row that is not archived", async () => {
    const taken = await inject("POST", "/addons", {
      name: "Bacon",
      price_cents: 1,
    });
    const live = await inject("POST", `/addons/${bacon.id}/restore`);

    expect(taken.json()).not.toHaveProperty("details");
    expect(live.json()).not.toHaveProperty("details");
  });

  it("lists the items and combos holding a category", async () => {
    const combo = await post("/combos", {
      name: "Combo Picanha",
      components: [
        { item_id: burger.id, quantity: 1, swap_category_id: snacks.id },
      ],
    });

    expect(await details("DELETE", `/categories/${snacks.id}`)).toEqual({
      items: [{ id: burger.id, name: "Picanha" }],
      combos: [{ id: combo.id, name: "Combo Picanha" }],
    });
  });

  it("lists the items holding an addon", async () => {
    expect(await details("DELETE", `/addons/${bacon.id}`)).toEqual({
      items: [{ id: burger.id, name: "Picanha" }],
    });
  });

  it("lists the combos holding an item", async () => {
    const combo = await post("/combos", {
      name: "Combo Picanha",
      components: [{ item_id: burger.id, quantity: 1 }],
    });

    expect(await details("DELETE", `/items/${burger.id}`)).toEqual({
      combos: [{ id: combo.id, name: "Combo Picanha" }],
    });
  });

  it("lists the archived items and categories blocking a combo restore", async () => {
    const combo = await post("/combos", {
      name: "Combo Picanha",
      components: [
        { item_id: burger.id, quantity: 1 },
        { item_id: soda.id, quantity: 1, swap_category_id: drinks.id },
      ],
    });
    await inject("DELETE", `/combos/${combo.id}`);
    await inject("DELETE", `/items/${soda.id}`);
    await inject("DELETE", `/categories/${drinks.id}`);

    expect(await details("POST", `/combos/${combo.id}/restore`)).toEqual({
      items: [{ id: soda.id, name: "Refrigerante" }],
      categories: [{ id: drinks.id, name: "Bebidas" }],
    });
  });

  it("names the archived category blocking an item restore", async () => {
    await inject("DELETE", `/items/${soda.id}`);
    await inject("DELETE", `/categories/${drinks.id}`);

    expect(await details("POST", `/items/${soda.id}/restore`)).toEqual({
      categories: [{ id: drinks.id, name: "Bebidas" }],
    });
  });

  it("lists the ids of unknown or archived references", async () => {
    const ghost = randomUUID();
    await inject("DELETE", `/items/${soda.id}`);
    await inject("DELETE", `/categories/${drinks.id}`);

    expect(
      await details("POST", "/combos", {
        name: "Combo",
        components: [{ item_id: ghost, quantity: 1 }],
      }),
    ).toEqual({ ids: [ghost] });
    expect(
      await details("POST", "/combos", {
        name: "Combo",
        components: [
          { item_id: burger.id, quantity: 1, swap_category_id: ghost },
        ],
      }),
    ).toEqual({ ids: [ghost] });
    expect(
      await details("POST", "/items", {
        category_id: drinks.id,
        name: "Suco",
        price_cents: 800,
      }),
    ).toEqual({ ids: [drinks.id] });
    expect(
      await details("PATCH", `/items/${burger.id}`, { addon_ids: [ghost] }),
    ).toEqual({ ids: [ghost] });
  });

  it("carries the suggested price above the ceiling", async () => {
    const wagyu = await post("/items", {
      category_id: snacks.id,
      name: "Wagyu",
      price_cents: 100_000_000,
    });

    expect(
      await details("POST", "/combos", {
        name: "Combo Wagyu",
        components: [{ item_id: wagyu.id, quantity: 2 }],
      }),
    ).toEqual({ suggested_price_cents: 200_000_000 });
  });
});

describe("listing archived", () => {
  async function ids(url: string) {
    const response = await inject("GET", url);
    expect(response.statusCode).toBe(200);
    return response.json().map((row: Ref) => row.id);
  }

  async function expectSplit(path: string, live: string, archived: string) {
    expect(await ids(`/${path}?archived=true`)).toEqual([archived]);
    expect(await ids(`/${path}`)).toEqual([live]);
    expect(await ids(`/${path}?archived=false`)).toEqual([live]);
  }

  it("splits categories", async () => {
    const desserts = await post("/categories", { name: "Sobremesas" });
    await inject("DELETE", `/categories/${desserts.id}`);

    expect(await ids("/categories?archived=true")).toEqual([desserts.id]);
    expect((await ids("/categories")).sort()).toEqual(
      [snacks.id, drinks.id].sort(),
    );
    expect((await ids("/categories?archived=false")).sort()).toEqual(
      [snacks.id, drinks.id].sort(),
    );
  });

  it("splits items", async () => {
    await inject("DELETE", `/items/${soda.id}`);

    await expectSplit("items", burger.id, soda.id);
  });

  it("splits addons", async () => {
    const egg = await post("/addons", { name: "Ovo", price_cents: 300 });
    await inject("DELETE", `/addons/${egg.id}`);

    await expectSplit("addons", bacon.id, egg.id);
  });

  it("splits combos and keeps an archived combo's components", async () => {
    const live = await post("/combos", {
      name: "Combo Picanha",
      components: [{ item_id: burger.id, quantity: 1 }],
    });
    const old = await post("/combos", {
      name: "Combo Refri",
      components: [{ item_id: soda.id, quantity: 2 }],
    });
    await inject("DELETE", `/combos/${old.id}`);
    await inject("DELETE", `/items/${soda.id}`);

    await expectSplit("combos", live.id, old.id);
    expect((await inject("GET", "/combos?archived=true")).json()).toEqual([
      {
        id: old.id,
        name: "Combo Refri",
        price_cents: 1400,
        suggested_price_cents: 1400,
        components: [
          {
            id: expect.any(String),
            item_id: soda.id,
            quantity: 2,
            swap_category_id: null,
          },
        ],
      },
    ]);
  });

  it("refuses anything but true or false", async () => {
    for (const query of ["archived=1", "archived=yes", "foo=bar"]) {
      const response = await inject("GET", `/items?${query}`);

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_FAILED");
    }
  });

  it("keeps archived rows out of the menu", async () => {
    await inject("DELETE", `/items/${soda.id}`);

    expect((await inject("GET", "/menu")).body).not.toContain("Refrigerante");
  });
});
