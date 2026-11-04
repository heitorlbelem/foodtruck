import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./users.ts", import.meta.url));

describe("users cli", () => {
  it("explains a connection failure instead of printing a blank line", () => {
    const result = spawnSync(process.execPath, [CLI, "list"], {
      env: {
        ...process.env,
        DATABASE_URL: "postgres://nobody:nothing@localhost:1/none",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toMatch(/ECONNREFUSED/);
  });
});
