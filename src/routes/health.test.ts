import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.ts";

describe("GET /health", () => {
  const app = buildApp();

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("responds with 200 and json", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("reports the database in snake_case", async () => {
    const body = (await app.inject({ method: "GET", url: "/health" })).json();

    expect(Object.keys(body)).toEqual(["updated_at", "database"]);
    expect(body.database).toEqual({
      status: "ok",
      server_version: expect.stringMatching(/^\d+/),
      latency_ms: expect.any(Number),
      pool: {
        total: expect.any(Number),
        idle: expect.any(Number),
        waiting: expect.any(Number),
      },
    });
  });

  it("refreshes the date on every request", async () => {
    const first = await app.inject({ method: "GET", url: "/health" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await app.inject({ method: "GET", url: "/health" });

    expect(second.json().updated_at >= first.json().updated_at).toBe(true);
  });
});

describe("GET /health with the database down", () => {
  const unreachable = new Pool({
    connectionString: "postgresql://foodtruck:foodtruck@localhost:1/foodtruck",
  });
  const app = buildApp({}, unreachable);

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("responds with 503 and reports it in the body", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json().database.status).toBe("unavailable");
  });

  it("never leaks the connection error", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.payload).not.toContain("ECONNREFUSED");
    expect(response.json().database).not.toHaveProperty("error");
  });
});

describe("GET /health/live", () => {
  const app = buildApp();

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("responds with 200 and nothing but the status", async () => {
    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("GET /health/live with the database down", () => {
  const unreachable = new Pool({
    connectionString: "postgresql://foodtruck:foodtruck@localhost:1/foodtruck",
  });
  const app = buildApp({}, unreachable);

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("still responds with 200", async () => {
    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
  });
});

describe("error responses", () => {
  const app = buildApp();

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("returns unknown routes in snake_case", async () => {
    const response = await app.inject({ method: "GET", url: "/nao-existe" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      status_code: 404,
      error: "Not Found",
      message: "Route GET:/nao-existe not found",
    });
  });
});
