import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn("categories", { archived_at: { type: "timestamptz" } });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumn("categories", "archived_at");
}
