import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "addons",
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

  pgm.createTable("item_addons", {
    item_id: {
      type: "uuid",
      notNull: true,
      primaryKey: true,
      references: "items",
      onDelete: "CASCADE",
    },
    addon_id: {
      type: "uuid",
      notNull: true,
      primaryKey: true,
      references: "addons",
    },
  });

  pgm.createIndex("item_addons", "addon_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("item_addons");
  pgm.dropTable("addons");
}
