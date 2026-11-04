import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable(
    "combos",
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

  pgm.createTable("combo_components", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    combo_id: {
      type: "uuid",
      notNull: true,
      references: "combos",
      onDelete: "CASCADE",
    },
    item_id: { type: "uuid", notNull: true, references: "items" },
    quantity: { type: "integer", notNull: true, check: "quantity >= 1" },
    swap_category_id: { type: "uuid", references: "categories" },
    sort_order: { type: "integer", notNull: true },
  });

  pgm.createIndex("combo_components", "combo_id");
  pgm.createIndex("combo_components", "item_id");
  pgm.createIndex("combo_components", "swap_category_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("combo_components");
  pgm.dropTable("combos");
}
