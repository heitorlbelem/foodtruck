import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("login_attempts", {
    key: { type: "text", primaryKey: true },
    window_start: { type: "timestamptz", notNull: true },
    count: { type: "integer", notNull: true },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("login_attempts");
}
