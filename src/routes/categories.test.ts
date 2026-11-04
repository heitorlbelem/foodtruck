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

describe("categories", () => {
  it("creates a category and returns it", async () => {
    const response = await inject("POST", "/categories", { name: "Bebidas" });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: expect.any(String),
      name: "Bebidas",
      sort_order: 0,
    });
  });

  it("lists categories by sort_order then name", async () => {
    await inject("POST", "/categories", { name: "Lanches", sort_order: 2 });
    await inject("POST", "/categories", { name: "Bebidas", sort_order: 1 });
    await inject("POST", "/categories", {
      name: "Acompanhamentos",
      sort_order: 2,
    });

    const names = (await inject("GET", "/categories"))
      .json()
      .map((category: { name: string }) => category.name);

    expect(names).toEqual(["Bebidas", "Acompanhamentos", "Lanches"]);
  });

  it("refuses a duplicate name with 409", async () => {
    await inject("POST", "/categories", { name: "Bebidas" });
    const response = await inject("POST", "/categories", { name: "Bebidas" });

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("Bebidas");
  });

  it("refuses an empty name with 400", async () => {
    const response = await inject("POST", "/categories", { name: "" });

    expect(response.statusCode).toBe(400);
  });

  it("refuses a missing name with 400", async () => {
    const response = await inject("POST", "/categories", { sort_order: 1 });

    expect(response.statusCode).toBe(400);
  });

  it("refuses unknown fields with 400", async () => {
    const response = await inject("POST", "/categories", {
      name: "X",
      price_cents: 1,
    });

    expect(response.statusCode).toBe(400);
    expect((await inject("GET", "/categories")).json()).toEqual([]);
  });

  it("renames a category", async () => {
    const created = (
      await inject("POST", "/categories", { name: "Bebida" })
    ).json();

    const response = await inject("PATCH", `/categories/${created.id}`, {
      name: "Bebidas",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: created.id,
      name: "Bebidas",
      sort_order: 0,
    });
  });

  it("refuses renaming onto an existing name with 409", async () => {
    await inject("POST", "/categories", { name: "Bebidas" });
    const other = (
      await inject("POST", "/categories", { name: "Lanches" })
    ).json();

    const response = await inject("PATCH", `/categories/${other.id}`, {
      name: "Bebidas",
    });

    expect(response.statusCode).toBe(409);
  });

  it("answers 404 when renaming a category that does not exist", async () => {
    const response = await inject("PATCH", `/categories/${randomUUID()}`, {
      name: "Bebidas",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe("category not found");
  });

  it("answers 400 for an id that is not a uuid", async () => {
    const response = await inject("PATCH", "/categories/abc", { name: "X" });

    expect(response.statusCode).toBe(400);
  });

  it("deletes a category", async () => {
    const created = (
      await inject("POST", "/categories", { name: "Bebidas" })
    ).json();

    const response = await inject("DELETE", `/categories/${created.id}`);

    expect(response.statusCode).toBe(204);
    expect((await inject("GET", "/categories")).json()).toEqual([]);
  });

  it("answers 404 when deleting a category that does not exist", async () => {
    const response = await inject("DELETE", `/categories/${randomUUID()}`);

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toBe("category not found");
  });
});
