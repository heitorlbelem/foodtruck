import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";

import { createPool } from "../infra/db/pool.ts";
import {
  createUser,
  listUsers,
  resetPassword,
  revokeSessions,
  setUserActive,
} from "../modules/users/users.admin.ts";
import type { Role } from "../modules/users/users.repository.ts";

const USAGE = `Usage: npm run users -- <command> [options]

Commands:
  create --email <email> --name <name> [--role <role>]
  reset-password --email <email>
  revoke-sessions --email <email>
  deactivate --email <email>
  activate --email <email>
  list`;

async function readHidden(prompt: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) {
        process.stderr.write(chunk);
      }
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });

  try {
    const answer = rl.question(prompt);
    muted = true;
    return await answer;
  } finally {
    rl.close();
    process.stderr.write("\n");
  }
}

async function readNewPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error("Passwords are read from an interactive terminal only");
  }

  const password = await readHidden("Password: ");
  const confirmation = await readHidden("Repeat password: ");

  if (password !== confirmation) {
    throw new Error("Passwords do not match");
  }

  return password;
}

function requireOption(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`--${name} is required`);
  }

  return value;
}

async function run(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
    },
  });
  const [command] = positionals;
  const commands = [
    "create",
    "reset-password",
    "revoke-sessions",
    "deactivate",
    "activate",
    "list",
  ];

  if (!command || positionals.length > 1 || !commands.includes(command)) {
    throw new Error(USAGE);
  }

  const email = command === "list" ? "" : requireOption(values.email, "email");
  const password =
    command === "create" || command === "reset-password"
      ? await readNewPassword()
      : "";
  const db = createPool();

  try {
    switch (command) {
      case "create": {
        const user = await createUser(db, {
          email,
          name: requireOption(values.name, "name"),
          password,
          role: values.role as Role | undefined,
        });
        console.log(`Created ${user.role} ${user.email}`);
        break;
      }
      case "reset-password": {
        const revoked = await resetPassword(db, email, password);
        console.log(`Password reset; ${revoked} session(s) revoked`);
        break;
      }
      case "revoke-sessions": {
        const revoked = await revokeSessions(db, email);
        console.log(`${revoked} session(s) revoked`);
        break;
      }
      case "deactivate":
        await setUserActive(db, email, false);
        console.log(`Deactivated ${email}`);
        break;
      case "activate":
        await setUserActive(db, email, true);
        console.log(`Activated ${email}`);
        break;
      case "list":
        console.table(
          (await listUsers(db)).map((user) => ({
            email: user.email,
            name: user.name,
            role: user.role,
            active: user.active,
            live_sessions: user.live_sessions,
          })),
        );
        break;
    }
  } finally {
    await db.end();
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (error.message) {
    return error.message;
  }

  const inner =
    error instanceof AggregateError
      ? error.errors.map(describeError).filter(Boolean)
      : [];
  const code = (error as { code?: unknown }).code;

  return (
    [...new Set(inner)].join("; ") ||
    (typeof code === "string" ? code : "") ||
    error.name
  );
}

try {
  await run();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}
