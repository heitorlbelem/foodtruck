import type { Pool, PoolClient } from "pg";

import { withTransaction } from "../infra/db/transaction.ts";
import type { RestoreResult } from "./archived.ts";

export type Category = { id: string; name: string; sort_order: number };

const COLUMNS = "id, name, sort_order";

export async function listCategories(
  db: Pool | PoolClient,
  foodtruckId: string,
): Promise<Category[]> {
  const { rows } = await db.query<Category>(
    `SELECT ${COLUMNS} FROM categories
      WHERE foodtruck_id = $1 AND archived_at IS NULL
      ORDER BY sort_order, name`,
    [foodtruckId],
  );

  return rows;
}

export async function createCategory(
  db: Pool,
  foodtruckId: string,
  input: { name: string; sort_order?: number },
): Promise<Category> {
  const { rows } = await db.query<Category>(
    `INSERT INTO categories (foodtruck_id, name, sort_order)
     VALUES ($1, $2, coalesce($3, 0))
     RETURNING ${COLUMNS}`,
    [foodtruckId, input.name, input.sort_order ?? null],
  );

  return rows[0]!;
}

export async function updateCategory(
  db: Pool,
  id: string,
  input: { name?: string; sort_order?: number },
): Promise<Category | undefined> {
  const { rows } = await db.query<Category>(
    `UPDATE categories
        SET name = coalesce($2, name),
            sort_order = coalesce($3, sort_order),
            updated_at = now()
      WHERE id = $1 AND archived_at IS NULL
      RETURNING ${COLUMNS}`,
    [id, input.name ?? null, input.sort_order ?? null],
  );

  return rows[0];
}

export type ArchiveCategoryResult =
  | { archived: true }
  | { archived: false; reason: "not_found" }
  | {
      archived: false;
      reason: "in_use";
      name: string;
      items: string[];
      combos: string[];
    };

export async function archiveCategory(
  db: Pool,
  id: string,
): Promise<ArchiveCategoryResult> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ name: string }>(
      `SELECT name FROM categories
        WHERE id = $1 AND archived_at IS NULL
          FOR UPDATE`,
      [id],
    );

    if (!rows[0]) {
      return { archived: false, reason: "not_found" };
    }

    const items = await tx.query<{ name: string }>(
      `SELECT name FROM items
        WHERE category_id = $1 AND archived_at IS NULL
        ORDER BY name`,
      [id],
    );
    const combos = await tx.query<{ name: string }>(
      `SELECT DISTINCT combo.name
         FROM combo_components component
         JOIN combos combo ON combo.id = component.combo_id
        WHERE component.swap_category_id = $1 AND combo.archived_at IS NULL
        ORDER BY combo.name`,
      [id],
    );

    if (items.rows.length > 0 || combos.rows.length > 0) {
      return {
        archived: false,
        reason: "in_use",
        name: rows[0].name,
        items: items.rows.map((item) => item.name),
        combos: combos.rows.map((combo) => combo.name),
      };
    }

    await tx.query(
      `UPDATE categories
          SET archived_at = now(), updated_at = now()
        WHERE id = $1`,
      [id],
    );

    return { archived: true };
  });
}

export async function restoreCategory(
  db: Pool,
  id: string,
): Promise<RestoreResult<Category>> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ archived: boolean }>(
      `SELECT archived_at IS NOT NULL AS archived FROM categories
        WHERE id = $1
          FOR UPDATE`,
      [id],
    );

    if (!rows[0]) {
      return { status: "not_found" };
    }

    if (!rows[0].archived) {
      return { status: "not_archived" };
    }

    const restored = await tx.query<Category>(
      `UPDATE categories
          SET archived_at = NULL, updated_at = now()
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id],
    );

    return { status: "restored", row: restored.rows[0]! };
  });
}
