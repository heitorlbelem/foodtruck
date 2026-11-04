import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.ts";
import { resetCatalog } from "../../infra/db/testing.ts";
import { makeFoodtruckRepository } from "../foodtruck/foodtruck.repository.ts";
import { checkPassword, hashPassword, verifyPassword } from "./passwords.ts";
import { makeUserRepository } from "./users.repository.ts";

const app = buildApp();

beforeAll(() => app.ready());
beforeEach(() => resetCatalog(app.db));
afterAll(() => app.close());

async function newUser(email: string) {
  const foodtruckId = await makeFoodtruckRepository(app.db).currentId();
  return makeUserRepository(app.db).create({
    foodtruckId,
    name: "Dono",
    email,
    passwordHash: "hash",
    role: "owner",
  });
}

describe("passwords", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword("correct horse battery");

    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });

  it("checks password length", () => {
    expect(checkPassword("a".repeat(11))).toEqual(expect.any(String));
    expect(checkPassword("a".repeat(12))).toBeNull();
    expect(checkPassword("a".repeat(128))).toBeNull();
    expect(checkPassword("a".repeat(129))).toEqual(expect.any(String));
  });
});

describe("user repository", () => {
  it("stores the email normalized and finds it in any case", async () => {
    const user = await newUser(" Dono@Foodtruck.com ");

    expect(user.email).toBe("dono@foodtruck.com");

    const found = await makeUserRepository(app.db).findByEmail(
      "DONO@foodtruck.com",
    );
    expect(found).toMatchObject({ id: user.id, password_hash: "hash" });
  });

  it("refuses a duplicate email", async () => {
    await newUser(" Dono@Foodtruck.com ");

    await expect(newUser("dono@foodtruck.com")).rejects.toThrow();
  });

  it("never returns the hash from findById or list", async () => {
    const user = await newUser("dono@foodtruck.com");
    const repo = makeUserRepository(app.db);

    expect(await repo.findById(user.id)).not.toHaveProperty("password_hash");
    expect((await repo.list())[0]).not.toHaveProperty("password_hash");
  });
});
