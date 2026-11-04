import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: loadEnv("development", process.cwd(), ""),
    // Every test file shares one Postgres database and truncates its tables,
    // so files running in parallel would delete each other's rows.
    fileParallelism: false,
  },
});
