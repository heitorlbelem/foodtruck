import { Validator } from "@seriousme/openapi-schema-validator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.ts";
import { authHeaders } from "../auth/testing.ts";
import { resetCatalog } from "../../infra/db/testing.ts";
import { ERROR_CODES } from "../../shared/error-codes.ts";
import { TAGS } from "./guide.ts";

type Operation = {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: { name: string }[];
  responses: Record<string, any>;
};

const app = buildApp();
const routes: { method: string; url: string }[] = [];

app.addHook("onRoute", (route) => {
  for (const method of [route.method].flat()) {
    if (method !== "HEAD" && route.url.startsWith("/api/v1")) {
      routes.push({ method: method.toLowerCase(), url: route.url });
    }
  }
});

let doc: any;

beforeAll(async () => {
  await app.ready();
  doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json();
});
afterAll(() => app.close());

function openapiPath(url: string) {
  return url.replace(/:(\w+)/g, "{$1}");
}

function operation(method: string, url: string): Operation {
  return doc.paths[openapiPath(url)]?.[method];
}

function resolve(schema: any) {
  const ref: string | undefined = schema?.$ref;
  return ref ? doc.components.schemas[ref.split("/").pop()!] : schema;
}

function errorEnum(response: any) {
  return resolve(response?.content?.["application/json"]?.schema)?.properties
    ?.code?.enum;
}

describe("openapi document", () => {
  it("serves a valid OpenAPI 3.1 document", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });

    expect(response.statusCode).toBe(200);
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "https://foodtruck-api.fly.dev" }]);
    expect(await new Validator().validate(doc)).toEqual({ valid: true });
  });

  it("documents every /api/v1 route", () => {
    expect(routes.length).toBeGreaterThan(20);

    for (const { method, url } of routes) {
      const op = operation(method, url);
      const label = `${method.toUpperCase()} ${url}`;

      expect(op, label).toBeDefined();
      expect(op.summary, label).toBeTruthy();
      expect(op.description, label).toBeTruthy();
      expect(op.tags, label).toHaveLength(1);
      expect(
        TAGS.map((tag) => tag.name),
        label,
      ).toContain(op.tags![0]);
      if (
        url === "/api/v1/menu" ||
        url === "/api/v1/auth/me" ||
        url === "/api/v1/auth/logout"
      ) {
        expect(op.responses["400"], label).toBeUndefined();
      } else {
        expect(errorEnum(op.responses["400"]), label).toEqual([...ERROR_CODES]);
      }

      expect(errorEnum(op.responses["500"]), label).toEqual([...ERROR_CODES]);

      const isPublic = ["/api/v1/auth/login", "/api/v1/auth/refresh"].includes(
        url,
      );
      expect(op.security, label).toEqual(
        isPublic ? undefined : [{ bearerAuth: [] }],
      );
      expect(Boolean(op.responses["401"]), label).toBe(true);
      expect(Boolean(op.responses["403"]), label).toBe(!isPublic);

      if (url.includes(":id")) {
        expect(op.responses["404"], label).toBeDefined();
      }

      if (
        (method === "post" || method === "patch") &&
        !url.endsWith("/restore") &&
        !url.endsWith("/auth/logout")
      ) {
        expect(op.responses["413"], label).toBeDefined();
        expect(op.responses["415"], label).toBeDefined();
      }
    }
  });

  it("declares the conflict and reference errors the routes can return", () => {
    for (const resource of ["categories", "items", "addons", "combos"]) {
      const base = `/api/v1/${resource}`;

      expect(operation("post", base).responses["409"], resource).toBeDefined();
      expect(
        operation("patch", `${base}/:id`).responses["409"],
        resource,
      ).toBeDefined();
      if (resource !== "combos") {
        expect(
          operation("delete", `${base}/:id`).responses["409"],
          resource,
        ).toBeDefined();
      }
      expect(
        operation("post", `${base}/:id/restore`).responses["409"],
        resource,
      ).toBeDefined();
    }

    for (const resource of ["items", "combos"]) {
      const base = `/api/v1/${resource}`;

      expect(operation("post", base).responses["422"], resource).toBeDefined();
      expect(
        operation("patch", `${base}/:id`).responses["422"],
        resource,
      ).toBeDefined();
    }
  });

  it("names the shared schemas and marks always-present fields as required", () => {
    const schemas = doc.components.schemas;

    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining(["Error", "Category", "Addon", "Item", "Combo"]),
    );
    expect(
      operation("get", "/api/v1/items").responses["200"].content[
        "application/json"
      ].schema.items,
    ).toEqual({ $ref: "#/components/schemas/Item" });
    expect(schemas.Item.required).toEqual(
      expect.arrayContaining([
        "id",
        "category_id",
        "name",
        "price_cents",
        "ingredients",
        "addons",
      ]),
    );
    expect(schemas.Combo.required).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "price_cents",
        "suggested_price_cents",
        "components",
      ]),
    );
    expect(schemas.Combo.properties.components.items.required).toEqual(
      expect.arrayContaining(["id", "item_id", "quantity", "swap_category_id"]),
    );
    expect(schemas.Error.required).toEqual([
      "status_code",
      "error",
      "code",
      "message",
    ]);
  });

  it("names the menu response", () => {
    const schemas = doc.components.schemas;

    expect(
      operation("get", "/api/v1/menu").responses["200"].content[
        "application/json"
      ].schema,
    ).toEqual({ $ref: "#/components/schemas/Menu" });
    expect(schemas.Menu.properties.categories.items).toEqual({
      $ref: "#/components/schemas/MenuCategory",
    });
    expect(schemas.MenuCategory.required).toEqual(
      expect.arrayContaining(["id", "name", "sort_order", "items"]),
    );
  });

  it("gives every named schema an example", () => {
    const schemas = doc.components.schemas;

    for (const name of [
      "Error",
      "Category",
      "Addon",
      "Item",
      "Combo",
      "MenuCategory",
      "Menu",
    ]) {
      expect(schemas[name].examples?.length, name).toBeGreaterThan(0);
    }

    expect(schemas.Error.examples).toContainEqual(
      expect.objectContaining({
        code: "IN_USE",
        details: expect.objectContaining({ items: expect.any(Array) }),
      }),
    );
  });

  it("warns that listings refuse unknown query parameters", () => {
    for (const resource of ["categories", "items", "addons", "combos"]) {
      expect(
        operation("get", `/api/v1/${resource}`).responses["400"].description,
        resource,
      ).toContain("parâmetro de query desconhecido");
    }

    expect(doc.info.description).toContain("parâmetro de query desconhecido");
  });

  it("documents the archived filter on every listing", () => {
    for (const resource of ["categories", "items", "addons", "combos"]) {
      const param = operation("get", `/api/v1/${resource}`).parameters?.find(
        (p: any) => p.name === "archived",
      );

      expect(param, resource).toMatchObject({
        in: "query",
        schema: { enum: ["true", "false"] },
      });
    }
  });

  it("leaves health and the docs themselves out", () => {
    const paths = Object.keys(doc.paths);

    expect(paths.filter((path) => !path.startsWith("/api/v1/"))).toEqual([]);
  });

  it("serves the docs page", async () => {
    let response = await app.inject({ method: "GET", url: "/docs" });

    if (response.statusCode === 302) {
      response = await app.inject({
        method: "GET",
        url: response.headers.location as string,
      });
    }

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
  });
});

describe("integration guide", () => {
  it("carries the integration guide", () => {
    const guide: string = doc.info.description;

    for (const heading of [
      "## Modelo do cardápio",
      "## Primeiro acesso",
      "## Lendo o cardápio",
      "## Regras",
      "## Erros",
      "## Arquivar e restaurar",
      "## O que ainda não existe",
    ]) {
      expect(guide).toContain(heading);
    }

    for (const code of ERROR_CODES) {
      expect(guide).toContain(`\`${code}\``);
    }

    for (const tag of doc.tags) {
      expect(tag.description.length, tag.name).toBeGreaterThanOrEqual(200);
    }
  });
});

describe("error responses with declared schemas", () => {
  beforeEach(() => resetCatalog(app.db));

  it("keeps details after declaring error schemas", async () => {
    const headers = await authHeaders(app);
    const post = async (url: string, payload: object) =>
      (await app.inject({ method: "POST", url, payload, headers })).json();
    const snacks = await post("/api/v1/categories", { name: "Lanches" });
    const bacon = await post("/api/v1/addons", {
      name: "Bacon",
      price_cents: 500,
    });
    await post("/api/v1/items", {
      category_id: snacks.id,
      name: "Picanha",
      price_cents: 4500,
      addon_ids: [bacon.id],
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/addons/${bacon.id}`,
      headers,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().details.items[0].name).toBe("Picanha");
  });
});
