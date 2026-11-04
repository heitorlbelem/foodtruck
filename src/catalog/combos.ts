import type { Pool, PoolClient } from "pg";

import { withTransaction } from "../infra/db/transaction.ts";
import type { RestoreResult } from "./archived.ts";
import { MAX_PRICE_CENTS } from "../shared/money.ts";

export type ComboComponent = {
  id: string;
  item_id: string;
  quantity: number;
  swap_category_id: string | null;
};

export type Combo = {
  id: string;
  name: string;
  price_cents: number;
  suggested_price_cents: number;
  components: ComboComponent[];
};

type ComponentInput = {
  item_id: string;
  quantity: number;
  swap_category_id?: string;
};

export type ComboInput = {
  name: string;
  price_cents?: number;
  components: ComponentInput[];
};

export class UnavailableItemsError extends Error {
  readonly itemIds: string[];

  constructor(itemIds: string[]) {
    super(`items not available: ${itemIds.join(", ")}`);
    this.itemIds = itemIds;
  }
}

export class UnknownCategoriesError extends Error {
  readonly categoryIds: string[];

  constructor(categoryIds: string[]) {
    super(`categories not found: ${categoryIds.join(", ")}`);
    this.categoryIds = categoryIds;
  }
}

export class SuggestedPriceTooHighError extends Error {
  readonly suggestedPriceCents: number;

  constructor(suggestedPriceCents: number) {
    super(`suggested price ${suggestedPriceCents} exceeds ${MAX_PRICE_CENTS}`);
    this.suggestedPriceCents = suggestedPriceCents;
  }
}

type ComboRow = Omit<Combo, "suggested_price_cents" | "components"> & {
  components: (ComboComponent & { price_cents: number })[];
};

const SELECT_COMBOS = `
  SELECT combo.id, combo.name, combo.price_cents,
         coalesce(
           (SELECT json_agg(
                     json_build_object(
                       'id', component.id,
                       'item_id', component.item_id,
                       'quantity', component.quantity,
                       'swap_category_id', component.swap_category_id,
                       'price_cents', item.price_cents
                     )
                     ORDER BY component.sort_order
                   )
              FROM combo_components component
              JOIN items item ON item.id = component.item_id
             WHERE component.combo_id = combo.id),
           '[]'
         ) AS components
    FROM combos combo`;

export function suggestedPriceCents(
  components: { quantity: number; price_cents: number }[],
): number {
  return components.reduce(
    (sum, component) => sum + component.quantity * component.price_cents,
    0,
  );
}

export async function listCombos(
  db: Pool | PoolClient,
  foodtruckId: string,
): Promise<Combo[]> {
  const { rows } = await db.query<ComboRow>(
    `${SELECT_COMBOS}
      WHERE combo.foodtruck_id = $1 AND combo.archived_at IS NULL
      ORDER BY combo.name`,
    [foodtruckId],
  );

  return rows.map(toCombo);
}

export async function createCombo(
  db: Pool,
  foodtruckId: string,
  input: ComboInput,
): Promise<Combo> {
  return withTransaction(db, async (tx) => {
    const prices = await checkReferences(tx, foodtruckId, input.components);
    const price = input.price_cents ?? suggestion(input.components, prices);

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO combos (foodtruck_id, name, price_cents)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [foodtruckId, input.name, price],
    );
    const comboId = rows[0]!.id;
    await insertComponents(tx, comboId, input.components);

    return (await readCombo(tx, comboId))!;
  });
}

export async function updateCombo(
  db: Pool,
  id: string,
  input: Partial<ComboInput>,
): Promise<Combo | undefined> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ foodtruck_id: string }>(
      `SELECT foodtruck_id FROM combos
        WHERE id = $1 AND archived_at IS NULL
          FOR UPDATE`,
      [id],
    );

    if (!rows[0]) {
      return undefined;
    }

    if (input.components) {
      await checkReferences(tx, rows[0].foodtruck_id, input.components);
      await tx.query("DELETE FROM combo_components WHERE combo_id = $1", [id]);
      await insertComponents(tx, id, input.components);
    }

    await tx.query(
      `UPDATE combos
          SET name = coalesce($2, name),
              price_cents = coalesce($3, price_cents),
              updated_at = now()
        WHERE id = $1`,
      [id, input.name ?? null, input.price_cents ?? null],
    );

    return readCombo(tx, id);
  });
}

function suggestion(
  components: ComponentInput[],
  prices: Map<string, number>,
): number {
  const cents = suggestedPriceCents(
    components.map((component) => ({
      quantity: component.quantity,
      price_cents: prices.get(component.item_id)!,
    })),
  );

  if (cents > MAX_PRICE_CENTS) {
    throw new SuggestedPriceTooHighError(cents);
  }

  return cents;
}

export async function archiveCombo(db: Pool, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE combos
        SET archived_at = now(), updated_at = now()
      WHERE id = $1 AND archived_at IS NULL`,
    [id],
  );

  return rowCount === 1;
}

export async function restoreCombo(
  db: Pool,
  id: string,
): Promise<RestoreResult<Combo>> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ archived: boolean }>(
      `SELECT archived_at IS NOT NULL AS archived FROM combos
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

    const references = await tx.query<{ name: string; archived: boolean }>(
      `SELECT name, archived_at IS NOT NULL AS archived FROM items
        WHERE id IN (SELECT item_id FROM combo_components WHERE combo_id = $1)
          FOR SHARE`,
      [id],
    );
    const swaps = await tx.query<{ name: string; archived: boolean }>(
      `SELECT name, archived_at IS NOT NULL AS archived FROM categories
        WHERE id IN (
                SELECT swap_category_id FROM combo_components WHERE combo_id = $1
              )
          FOR SHARE`,
      [id],
    );
    const blocked = [...references.rows, ...swaps.rows]
      .filter((row) => row.archived)
      .map((row) => row.name)
      .sort();

    if (blocked.length > 0) {
      return { status: "blocked", blocked_by: blocked };
    }

    await tx.query(
      `UPDATE combos
          SET archived_at = NULL, updated_at = now()
        WHERE id = $1`,
      [id],
    );

    return { status: "restored", row: (await readCombo(tx, id))! };
  });
}

async function checkReferences(
  tx: PoolClient,
  foodtruckId: string,
  components: ComponentInput[],
): Promise<Map<string, number>> {
  const itemIds = unique(components.map((component) => component.item_id));
  const { rows: items } = await tx.query<{ id: string; price_cents: number }>(
    `SELECT id, price_cents FROM items
      WHERE id = ANY($1::uuid[])
        AND foodtruck_id = $2
        AND archived_at IS NULL
        FOR SHARE`,
    [itemIds, foodtruckId],
  );
  const prices = new Map(items.map((item) => [item.id, item.price_cents]));
  const missingItems = itemIds.filter((itemId) => !prices.has(itemId));

  if (missingItems.length > 0) {
    throw new UnavailableItemsError(missingItems);
  }

  const categoryIds = unique(
    components.flatMap((component) =>
      component.swap_category_id ? [component.swap_category_id] : [],
    ),
  );
  const { rows: categories } = await tx.query<{ id: string }>(
    `SELECT id FROM categories
      WHERE id = ANY($1::uuid[])
        AND foodtruck_id = $2
        AND archived_at IS NULL
        FOR SHARE`,
    [categoryIds, foodtruckId],
  );
  const found = new Set(categories.map((category) => category.id));
  const missingCategories = categoryIds.filter(
    (categoryId) => !found.has(categoryId),
  );

  if (missingCategories.length > 0) {
    throw new UnknownCategoriesError(missingCategories);
  }

  return prices;
}

async function insertComponents(
  tx: PoolClient,
  comboId: string,
  components: ComponentInput[],
): Promise<void> {
  await tx.query(
    `INSERT INTO combo_components
       (combo_id, item_id, quantity, swap_category_id, sort_order)
     SELECT $1, listed.item_id, listed.quantity, listed.swap_category_id,
            listed.ordinality - 1
       FROM unnest($2::uuid[], $3::integer[], $4::uuid[])
            WITH ORDINALITY
            AS listed(item_id, quantity, swap_category_id, ordinality)`,
    [
      comboId,
      components.map((component) => component.item_id),
      components.map((component) => component.quantity),
      components.map((component) => component.swap_category_id ?? null),
    ],
  );
}

async function readCombo(
  tx: PoolClient,
  id: string,
): Promise<Combo | undefined> {
  const { rows } = await tx.query<ComboRow>(
    `${SELECT_COMBOS} WHERE combo.id = $1`,
    [id],
  );

  return rows[0] && toCombo(rows[0]);
}

function toCombo(row: ComboRow): Combo {
  return {
    id: row.id,
    name: row.name,
    price_cents: row.price_cents,
    suggested_price_cents: suggestedPriceCents(row.components),
    components: row.components.map(
      ({ id, item_id, quantity, swap_category_id }) => ({
        id,
        item_id,
        quantity,
        swap_category_id,
      }),
    ),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
