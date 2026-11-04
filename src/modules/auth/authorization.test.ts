import { randomUUID } from "node:crypto";

import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../../app.ts";
import { API_V1_PREFIX } from "../../shared/api.ts";
import { signAccessToken } from "./tokens.ts";
import { authHeaders } from "./testing.ts";

const PUBLIC = new Set([
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/refresh",
]);

const app = buildApp();
const routes: { method: string; url: string }[] = [];

app.addHook("onRoute", (route) => {
  for (const method of [route.method].flat()) {
    if (method !== "HEAD" && route.url.startsWith("/api/v1")) {
      routes.push({ method, url: route.url });
    }
  }
});

beforeAll(() => app.ready());
afterAll(() => app.close());

describe("authorization", () => {
  it("every /api/v1 route requires a token except login and refresh", async () => {
    const protectedRoutes = routes.filter(
      ({ method, url }) => !PUBLIC.has(`${method} ${url}`),
    );

    expect(protectedRoutes.length).toBeGreaterThan(20);

    for (const { method, url } of protectedRoutes) {
      const response = await app.inject({
        method: method as "GET",
        url: url.replace(/:id/g, randomUUID()),
      });
      const label = `${method} ${url}`;

      expect(response.statusCode, label).toBe(401);
      expect(response.json().code, label).toBe("UNAUTHENTICATED");
    }
  });

  it("refuses malformed authorization headers", async () => {
    const other = await signAccessToken(
      new TextEncoder().encode("x".repeat(40)),
      {
        sub: randomUUID(),
        sid: randomUUID(),
        role: "owner",
      },
    );
    const expired = await signAccessToken(
      app.auth.secret,
      { sub: randomUUID(), sid: randomUUID(), role: "owner" },
      new Date(Date.now() - 3_600_000),
    );
    const wrongAlg = await new SignJWT({ sid: randomUUID(), role: "owner" })
      .setProtectedHeader({ alg: "HS512" })
      .setSubject(randomUUID())
      .setIssuer("foodtruck-api")
      .setAudience("foodtruck-app")
      .setExpirationTime("15m")
      .sign(app.auth.secret);

    for (const authorization of [
      "Bearer",
      "Bearer ",
      "Basic abc",
      "garbage",
      `Bearer ${other}`,
      `Bearer ${expired}`,
      `Bearer ${wrongAlg}`,
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `${API_V1_PREFIX}/menu`,
        headers: { authorization },
      });

      expect(response.statusCode, authorization).toBe(401);
    }
  });

  it("forbids a role without the permission", async () => {
    const response = await app.inject({
      method: "GET",
      url: `${API_V1_PREFIX}/menu`,
      headers: await authHeaders(app, "nobody"),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("FORBIDDEN");
  });

  it("forbids roles named after object prototype properties", async () => {
    for (const role of ["constructor", "__proto__", "toString"]) {
      const response = await app.inject({
        method: "GET",
        url: `${API_V1_PREFIX}/menu`,
        headers: await authHeaders(app, role),
      });

      expect(response.statusCode, role).toBe(403);
      expect(response.json().code, role).toBe("FORBIDDEN");
    }
  });

  it("accepts the bearer scheme in any case", async () => {
    const { authorization } = await authHeaders(app);
    const token = authorization.slice("Bearer ".length);

    for (const scheme of ["bearer", "BEARER"]) {
      const response = await app.inject({
        method: "GET",
        url: `${API_V1_PREFIX}/menu`,
        headers: { authorization: `${scheme} ${token}` },
      });

      expect(response.statusCode, scheme).toBe(200);
    }
  });

  it("allows the owner", async () => {
    const response = await app.inject({
      method: "GET",
      url: `${API_V1_PREFIX}/menu`,
      headers: await authHeaders(app),
    });

    expect(response.statusCode).toBe(200);
  });

  it("refuses to boot with an undeclared route", async () => {
    const bad = buildApp();
    bad.register(
      async (v1) => {
        v1.get("/x", async () => ({}));
      },
      { prefix: API_V1_PREFIX },
    );

    await expect(bad.ready()).rejects.toThrow(/declares no permission/);
    await bad.close().catch(() => {});
  });

  it("refuses to boot with an undeclared route outside /api/v1", async () => {
    const bad = buildApp();
    bad.register(async (root) => {
      root.get("/admin", async () => ({}));
    });

    await expect(bad.ready()).rejects.toThrow(
      /route GET \/admin declares no permission/,
    );
    await bad.close().catch(() => {});
  });

  it("keeps health, docs and the contract public", async () => {
    for (const url of [
      "/health/live",
      "/health",
      "/openapi.json",
      "/docs",
      "/docs/",
      "/docs/json",
      "/docs/static/index.html",
    ]) {
      const response = await app.inject({ method: "GET", url });

      expect(response.statusCode, url).not.toBe(401);
    }
  });
});
