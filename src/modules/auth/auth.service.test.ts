import { randomBytes } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPool } from "../../infra/db/pool.ts";
import { resetCatalog } from "../../infra/db/testing.ts";
import { makeFoodtruckRepository } from "../foodtruck/foodtruck.repository.ts";
import { hashPassword } from "../users/passwords.ts";
import { makeUserRepository } from "../users/users.repository.ts";
import { makeAuthService } from "./auth.service.ts";
import {
  loadJwtSecret,
  newRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "./tokens.ts";

const db = createPool();
const secret = loadJwtSecret();
const auth = makeAuthService({ db, secret });
const passwordHash = hashPassword("correct horse battery");

beforeEach(() => resetCatalog(db));
afterAll(() => db.end());

async function newOwner(email = "dono@foodtruck.com") {
  const foodtruckId = await makeFoodtruckRepository(db).currentId();
  return makeUserRepository(db).create({
    foodtruckId,
    name: "Dono",
    email,
    passwordHash: await passwordHash,
    role: "owner",
  });
}

async function loginOwner() {
  const user = await newOwner();
  const pair = await auth.login("dono@foodtruck.com", "correct horse battery", {
    userAgent: "vitest",
    ip: "127.0.0.1",
  });
  const claims = await verifyAccessToken(secret, pair.access_token);
  return { user, pair, sid: claims!.sid };
}

async function sessionRow(sid: string) {
  const { rows } = await db.query<{
    revoked_at: Date | null;
    revoked_reason: string | null;
  }>("SELECT revoked_at, revoked_reason FROM sessions WHERE id = $1", [sid]);
  return rows[0]!;
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("tokens", () => {
  it("loadJwtSecret refuses a short secret", () => {
    expect(() => loadJwtSecret({ JWT_SECRET: "x".repeat(31) })).toThrow(
      "JWT_SECRET must be at least 32 bytes",
    );
    expect(() => loadJwtSecret({})).toThrow(
      "JWT_SECRET must be at least 32 bytes",
    );
    expect(loadJwtSecret({ JWT_SECRET: "x".repeat(32) })).toHaveLength(32);
  });

  it("rejects an expired or foreign access token", async () => {
    const claims = { sub: "user", sid: "session", role: "owner" };
    const old = new Date(Date.now() - 16 * 60 * 1000);
    const nowIat = Math.floor(Date.now() / 1000);

    expect(
      await verifyAccessToken(secret, await signAccessToken(secret, claims)),
    ).toEqual(claims);
    expect(
      await verifyAccessToken(
        secret,
        await signAccessToken(secret, claims, old),
      ),
    ).toBeNull();
    expect(
      await verifyAccessToken(
        secret,
        await signAccessToken(randomBytes(32), claims),
      ),
    ).toBeNull();
    expect(await verifyAccessToken(secret, "not.a.jwt")).toBeNull();

    const unsigned = [
      base64url({ alg: "none", typ: "JWT" }),
      base64url({
        ...claims,
        iat: nowIat,
        exp: nowIat + 900,
        iss: "foodtruck-api",
        aud: "foodtruck-app",
      }),
      "",
    ].join(".");
    expect(await verifyAccessToken(secret, unsigned)).toBeNull();
  });
});

describe("auth service", () => {
  it("logs in and returns a verifiable access token", async () => {
    const user = await newOwner();

    const pair = await auth.login(
      " DONO@foodtruck.com ",
      "correct horse battery",
      {},
    );

    expect(pair).toMatchObject({
      token_type: "Bearer",
      expires_in: 900,
      user: {
        id: user.id,
        name: "Dono",
        email: "dono@foodtruck.com",
        role: "owner",
      },
    });
    expect(await verifyAccessToken(secret, pair.access_token)).toEqual({
      sub: user.id,
      role: "owner",
      sid: expect.any(String),
    });
    const expected = Date.now() + 24 * 60 * 60 * 1000;
    expect(
      Math.abs(new Date(pair.refresh_expires_at).getTime() - expected),
    ).toBeLessThan(1000);
  });

  it("rejects a wrong password, an unknown email and an inactive user the same way", async () => {
    const user = await newOwner();

    const wrong = await auth
      .login("dono@foodtruck.com", "wrong password!", {})
      .catch((error: unknown) => error);
    const unknown = await auth
      .login("ninguem@foodtruck.com", "correct horse battery", {})
      .catch((error: unknown) => error);
    await makeUserRepository(db).setActive(user.id, false);
    const inactive = await auth
      .login("dono@foodtruck.com", "correct horse battery", {})
      .catch((error: unknown) => error);

    for (const error of [wrong, unknown, inactive]) {
      expect(error).toMatchObject({
        statusCode: 401,
        code: "INVALID_CREDENTIALS",
        message: "invalid email or password",
      });
    }
  });

  it("rotates the refresh token", async () => {
    const { pair } = await loginOwner();

    const second = await auth.refresh(pair.refresh_token);

    expect(second.refresh_token).not.toBe(pair.refresh_token);
    expect(second.refresh_expires_at).toBe(pair.refresh_expires_at);
    await expect(auth.refresh(second.refresh_token)).resolves.toMatchObject({
      token_type: "Bearer",
    });
  });

  it("revokes the session when a used refresh token comes back", async () => {
    const { pair, sid } = await loginOwner();
    const second = await auth.refresh(pair.refresh_token);

    await expect(auth.refresh(pair.refresh_token)).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_REFRESH_TOKEN",
      message: "invalid refresh token",
    });
    await expect(auth.refresh(second.refresh_token)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
    expect((await sessionRow(sid)).revoked_reason).toBe("reuse");
  });

  it("lets only one of two parallel refreshes win", async () => {
    const { pair, sid } = await loginOwner();

    const results = await Promise.allSettled([
      auth.refresh(pair.refresh_token),
      auth.refresh(pair.refresh_token),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "INVALID_REFRESH_TOKEN" });
    expect(await sessionRow(sid)).toMatchObject({
      revoked_at: expect.any(Date),
      revoked_reason: "reuse",
    });
  });

  it("refuses refresh after 24 hours", async () => {
    const { pair, sid } = await loginOwner();
    await db.query(
      "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = $1",
      [sid],
    );

    await expect(auth.refresh(pair.refresh_token)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });

  it("refuses refresh for a deactivated user", async () => {
    const { user, pair } = await loginOwner();
    await makeUserRepository(db).setActive(user.id, false);

    await expect(auth.refresh(pair.refresh_token)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });

  it("logout revokes the session", async () => {
    const { pair, sid } = await loginOwner();

    await auth.logout(sid);

    await expect(auth.refresh(pair.refresh_token)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
    expect((await sessionRow(sid)).revoked_reason).toBe("logout");
    await expect(auth.logout(sid)).resolves.toBeUndefined();
    expect((await sessionRow(sid)).revoked_reason).toBe("logout");
  });

  it("refuses an unknown refresh token", async () => {
    await newOwner();

    await expect(auth.refresh(newRefreshToken())).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });
});
