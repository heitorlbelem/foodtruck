import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { buildApp } from "./app.ts";

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
