import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("sessions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    expires_at: { type: "timestamptz", notNull: true },
    revoked_at: { type: "timestamptz" },
    revoked_reason: { type: "text" },
    last_used_at: { type: "timestamptz" },
    user_agent: { type: "text" },
    ip: { type: "text" },
  });
  pgm.createIndex("sessions", "user_id");

  pgm.createTable("refresh_tokens", {
    token_hash: { type: "text", primaryKey: true },
    session_id: {
      type: "uuid",
      notNull: true,
      references: "sessions",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    consumed_at: { type: "timestamptz" },
  });
  pgm.createIndex("refresh_tokens", "session_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("refresh_tokens");
  pgm.dropTable("sessions");
}
