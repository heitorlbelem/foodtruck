import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "items",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      foodtruck_id: {
        type: "uuid",
        notNull: true,
        references: "foodtrucks",
        onDelete: "CASCADE",
      },
      category_id: { type: "uuid", notNull: true, references: "categories" },
      name: { type: "text", notNull: true },
      price_cents: {
        type: "integer",
        notNull: true,
        check: "price_cents >= 0",
      },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
      updated_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
      archived_at: { type: "timestamptz" },
    },
    { constraints: { unique: [["foodtruck_id", "name"]] } },
  );

  pgm.createIndex("items", "category_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("items");
}
