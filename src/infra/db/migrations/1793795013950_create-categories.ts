import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("categories", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    foodtruck_id: {
      type: "uuid",
      notNull: true,
      references: "foodtrucks (id)",
      onDelete: "CASCADE",
    },
    name: { type: "text", notNull: true },
    sort_order: { type: "integer", notNull: true, default: 0 },
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
  });

  pgm.addConstraint("categories", "categories_foodtruck_id_name_key", {
    unique: ["foodtruck_id", "name"],
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("categories");
}
