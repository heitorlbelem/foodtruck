import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createPool } from "../../infra/db/pool.ts";
import { resetCatalog } from "../../infra/db/testing.ts";
import { makeAuthService } from "../auth/auth.service.ts";
import { loadJwtSecret } from "../auth/tokens.ts";
import {
  createUser,
  listUsers,
  resetPassword,
  revokeSessions,
  setUserActive,
} from "./users.admin.ts";
import type { Role } from "./users.repository.ts";

const db = createPool();
const secret = loadJwtSecret();
const auth = makeAuthService({ db, secret });
const PASSWORD = "correct horse battery";
const EMAIL = "dono@x.com";
const META = { userAgent: "vitest", ip: "127.0.0.1" };

beforeEach(() => resetCatalog(db));
afterAll(() => db.end());

function newOwner() {
  return createUser(db, { email: EMAIL, name: "Dono", password: PASSWORD });
}

function beforeSessionInsert(run: () => Promise<unknown>): Pool {
  let pending: (() => Promise<unknown>) | null = run;

  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "query") {
        return Reflect.get(target, property, receiver);
      }

      return async (text: string, values?: unknown[]) => {
        if (pending && text.includes("INSERT INTO sessions")) {
          const step = pending;
          pending = null;
          await step();
        }

        return target.query(text, values);
      };
    },
  });
}

describe("users admin", () => {
  it("creates an owner", async () => {
    const user = await createUser(db, {
      email: "Dono@X.com",
      name: "Dono",
      password: PASSWORD,
    });

    expect(user.role).toBe("owner");
    expect(user.email).toBe("dono@x.com");
  });

  it("refuses a short password, a bad email and an unknown role", async () => {
    await expect(
      createUser(db, { email: EMAIL, name: "Dono", password: "short" }),
    ).rejects.toThrow();
    await expect(
      createUser(db, { email: "no-at", name: "Dono", password: PASSWORD }),
    ).rejects.toThrow();
    await expect(
      createUser(db, {
        email: EMAIL,
        name: "Dono",
        password: PASSWORD,
        role: "admin" as Role,
      }),
    ).rejects.toThrow();
    await expect(
      createUser(db, { email: EMAIL, name: "  ", password: PASSWORD }),
    ).rejects.toThrow();
  });

  it("reset-password changes the password and revokes sessions", async () => {
    await newOwner();
    const old = await auth.login(EMAIL, PASSWORD, META);

    const revoked = await resetPassword(db, EMAIL, "another long password");

    expect(revoked).toBe(1);
    await expect(auth.refresh(old.refresh_token)).rejects.toThrow();
    await expect(
      auth.login(EMAIL, "another long password", META),
    ).resolves.toBeDefined();
    await expect(auth.login(EMAIL, PASSWORD, META)).rejects.toThrow();
  });

  it("reset-password refuses a short password and keeps sessions", async () => {
    await newOwner();
    const pair = await auth.login(EMAIL, PASSWORD, META);

    await expect(resetPassword(db, EMAIL, "short")).rejects.toThrow();
    await expect(auth.refresh(pair.refresh_token)).resolves.toBeDefined();
  });

  it("revoke-sessions ends every session", async () => {
    await newOwner();
    await auth.login(EMAIL, PASSWORD, META);
    await auth.login(EMAIL, PASSWORD, META);

    expect(await revokeSessions(db, EMAIL)).toBe(2);
    expect(await revokeSessions(db, EMAIL)).toBe(0);
  });

  it("deactivate blocks login and revokes sessions; activate restores login", async () => {
    await newOwner();
    const pair = await auth.login(EMAIL, PASSWORD, META);

    await setUserActive(db, EMAIL, false);

    await expect(auth.refresh(pair.refresh_token)).rejects.toThrow();
    await expect(auth.login(EMAIL, PASSWORD, META)).rejects.toThrow();

    await setUserActive(db, EMAIL, true);

    await expect(auth.login(EMAIL, PASSWORD, META)).resolves.toBeDefined();
  });

  it("refuses a login that races a password reset", async () => {
    await newOwner();
    const racing = makeAuthService({
      db: beforeSessionInsert(() =>
        resetPassword(db, EMAIL, "another long password"),
      ),
      secret,
    });

    await expect(racing.login(EMAIL, PASSWORD, META)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect((await listUsers(db))[0]).toMatchObject({ live_sessions: 0 });
  });

  it("refuses a login that races a deactivation", async () => {
    await newOwner();
    const racing = makeAuthService({
      db: beforeSessionInsert(() => setUserActive(db, EMAIL, false)),
      secret,
    });

    await expect(racing.login(EMAIL, PASSWORD, META)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect((await listUsers(db))[0]).toMatchObject({ live_sessions: 0 });
  });

  it("list reports live sessions without hashes", async () => {
    await newOwner();
    await auth.login(EMAIL, PASSWORD, META);
    await auth.login(EMAIL, PASSWORD, META);

    const users = await listUsers(db);

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: EMAIL, live_sessions: 2 });
    expect(JSON.stringify(users)).not.toContain("argon2");
    expect(users[0]).not.toHaveProperty("password_hash");
  });

  it("unknown email rejects", async () => {
    await expect(resetPassword(db, "nobody@x.com", PASSWORD)).rejects.toThrow();
    await expect(revokeSessions(db, "nobody@x.com")).rejects.toThrow();
    await expect(setUserActive(db, "nobody@x.com", false)).rejects.toThrow();
  });
});
