import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.ts";
import { resetCatalog } from "../../infra/db/testing.ts";
import { makeFoodtruckRepository } from "../foodtruck/foodtruck.repository.ts";
import { hashPassword } from "../users/passwords.ts";
import { makeUserRepository } from "../users/users.repository.ts";

const app = buildApp();
const PASSWORD = "correct horse battery";
const EMAIL = "dono@foodtruck.com";

beforeAll(() => app.ready());
beforeEach(async () => {
  await resetCatalog(app.db);
  app.auth.limiter.clear();
  await makeUserRepository(app.db).create({
    foodtruckId: await makeFoodtruckRepository(app.db).currentId(),
    name: "Dono",
    email: EMAIL,
    passwordHash: await hashPassword(PASSWORD),
    role: "owner",
  });
});
afterAll(() => app.close());

function post(
  url: string,
  payload?: object,
  options: { remoteAddress?: string; token?: string } = {},
) {
  return app.inject({
    method: "POST",
    url: `/api/v1/auth${url}`,
    ...(payload ? { payload } : {}),
    ...(options.remoteAddress ? { remoteAddress: options.remoteAddress } : {}),
    ...(options.token
      ? { headers: { authorization: `Bearer ${options.token}` } }
      : {}),
  });
}

const login = (email = EMAIL, password = PASSWORD, remoteAddress?: string) =>
  post("/login", { email, password }, { remoteAddress });

describe("auth routes", () => {
  it("logs in with the email in any case and spacing", async () => {
    const response = await login(" Dono@Foodtruck.com ");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      user: { email: "dono@foodtruck.com" },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("answers the same 401 for wrong password and unknown email", async () => {
    const wrongPassword = await login(EMAIL, "wrong password here");
    const unknownEmail = await login("nobody@foodtruck.com");

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe("INVALID_CREDENTIALS");
      expect(response.headers["www-authenticate"]).toBe("Bearer");
    }
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
  });

  it("refuses an oversized password before hashing", async () => {
    const long = await login(EMAIL, "a".repeat(129));
    expect(long.statusCode).toBe(400);
    expect(long.json().code).toBe("VALIDATION_FAILED");

    const huge = await login(EMAIL, "a".repeat(1_000_000));
    expect([400, 413]).toContain(huge.statusCode);
  });

  it("blocks the sixth failure for an email", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login(EMAIL, "wrong password here")).statusCode).toBe(401);
    }

    const response = await login();
    const retryAfter = response.headers["retry-after"] as string;

    expect(response.statusCode).toBe(429);
    expect(response.json().code).toBe("TOO_MANY_ATTEMPTS");
    expect(retryAfter).toMatch(/^[1-9]\d*$/);
    expect(response.json().details.retry_after_seconds).toBe(
      Number(retryAfter),
    );
  });

  it("blocks an IP after 20 failures across emails", async () => {
    for (let i = 0; i < 20; i++) {
      const response = await login(
        `unknown${i}@foodtruck.com`,
        "wrong password here",
        "10.0.0.9",
      );
      expect(response.statusCode).toBe(401);
    }

    expect((await login(EMAIL, PASSWORD, "10.0.0.9")).statusCode).toBe(429);
    expect((await login(EMAIL, PASSWORD, "10.0.0.10")).statusCode).toBe(200);
  });

  it("refreshes and rejects a reused token over HTTP", async () => {
    const { refresh_token } = (await login()).json();

    const refreshed = await post("/refresh", { refresh_token });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().refresh_token).not.toBe(refresh_token);

    const reused = await post("/refresh", { refresh_token });
    expect(reused.statusCode).toBe(401);
    expect(reused.json().code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("me returns the user and logout ends the session", async () => {
    const { access_token, refresh_token } = (await login()).json();

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${access_token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      id: expect.any(String),
      name: "Dono",
      email: EMAIL,
      role: "owner",
    });

    const out = await post("/logout", undefined, { token: access_token });
    expect(out.statusCode).toBe(204);

    const refreshed = await post("/refresh", { refresh_token });
    expect(refreshed.statusCode).toBe(401);
  });

  it("me without a token is 401", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("UNAUTHENTICATED");
    expect(response.headers["www-authenticate"]).toBe("Bearer");
  });
});
