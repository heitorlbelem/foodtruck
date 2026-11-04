import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "item_ingredients",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      item_id: {
        type: "uuid",
        notNull: true,
        references: "items",
        onDelete: "CASCADE",
      },
      name: { type: "text", notNull: true },
      sort_order: { type: "integer", notNull: true },
    },
    { constraints: { unique: [["item_id", "name"]] } },
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("item_ingredients");
}
