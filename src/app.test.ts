import { randomUUID } from "node:crypto";

import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.ts";

describe("error codes", () => {
  const app = buildApp();
  app.get("/__boom", async () => {
    throw new Error("secret");
  });

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("answers VALIDATION_FAILED for a body that breaks the schema", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/addons",
      payload: { name: "", price_cents: 1 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_FAILED");
  });

  it("answers MALFORMED_REQUEST for invalid JSON", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/addons",
      headers: { "content-type": "application/json" },
      payload: "{",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("MALFORMED_REQUEST");
  });

  it("answers MALFORMED_REQUEST for an empty JSON body on DELETE", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/api/v1/addons/${randomUUID()}`,
      headers: { "content-type": "application/json" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("MALFORMED_REQUEST");
  });

  it("answers UNSUPPORTED_MEDIA_TYPE for text/xml", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/addons",
      headers: { "content-type": "text/xml" },
      payload: "<addon/>",
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("answers NOT_FOUND for an unknown route", async () => {
    const response = await app.inject({ method: "GET", url: "/nowhere" });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("NOT_FOUND");
  });

  it("answers INTERNAL_ERROR without leaking the cause", async () => {
    const response = await app.inject({ method: "GET", url: "/__boom" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      status_code: 500,
      error: "Internal Server Error",
      code: "INTERNAL_ERROR",
      message: "Internal Server Error",
    });
  });
});

describe("body limit", () => {
  const app = buildApp({ bodyLimit: 10 });

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("answers PAYLOAD_TOO_LARGE above the body limit", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/addons",
      payload: { name: "x".repeat(100), price_cents: 1 },
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("behind a proxy", () => {
  const app = buildApp();
  app.get("/__ip", async (request) => ({
    ip: request.ip,
    protocol: request.protocol,
  }));

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("reads the client ip and the protocol from the proxy headers", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/__ip",
      headers: {
        "x-forwarded-for": "203.0.113.7",
        "x-forwarded-proto": "https",
      },
    });

    expect(response.json()).toEqual({ ip: "203.0.113.7", protocol: "https" });
  });
});

describe("api versioning", () => {
  const app = buildApp();

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("serves the catalog under /api/v1", async () => {
    for (const path of ["categories", "items", "addons", "combos", "menu"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/${path}`,
      });

      expect(response.statusCode).toBe(200);
    }
  });

  it("answers 404 for a catalog route without the version", async () => {
    for (const path of ["categories", "items", "addons", "combos", "menu"]) {
      const response = await app.inject({ method: "GET", url: `/${path}` });

      expect(response.statusCode).toBe(404);
    }
  });

  it("keeps the health probes outside the version", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/health/live" })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/health/live" }))
        .statusCode,
    ).toBe(404);
  });
});

describe("an unexpected error on a documented route", () => {
  const app = buildApp();

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it("answers INTERNAL_ERROR through the declared 500 schema", async () => {
    const query = app.db.query;
    app.db.query = (async () => {
      throw new Error("connection lost");
    }) as unknown as typeof query;

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/addons",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        status_code: 500,
        error: "Internal Server Error",
        code: "INTERNAL_ERROR",
        message: "Internal Server Error",
      });
    } finally {
      app.db.query = query;
    }
  });
});
