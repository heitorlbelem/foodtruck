import type { Pool, PoolClient } from "pg";

import { isUniqueViolation } from "../../infra/db/errors.ts";
import { withTransaction } from "../../infra/db/transaction.ts";
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from "../../shared/errors.ts";
import { MAX_PRICE_CENTS } from "../../shared/money.ts";
import { makeCategoryRepository } from "../categories/categories.repository.ts";
import { makeItemRepository } from "../items/items.repository.ts";
import {
  type ComboComponent,
  type ComboRow,
  type ComponentInput,
  makeComboRepository,
} from "./combos.repository.ts";

export type Combo = {
  id: string;
  name: string;
  price_cents: number;
  suggested_price_cents: number;
  components: ComboComponent[];
};

export type ComboInput = {
  name: string;
  price_cents?: number;
  components: ComponentInput[];
};

export function suggestedPriceCents(
  components: { quantity: number; price_cents: number }[],
): number {
  return components.reduce(
    (sum, component) => sum + component.quantity * component.price_cents,
    0,
  );
}

export function toCombo(row: ComboRow): Combo {
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

export function makeComboService({ db }: { db: Pool }) {
  const combos = makeComboRepository(db);

  async function translateWriteError(
    error: unknown,
    foodtruckId: string,
    name: string | undefined,
  ): Promise<unknown> {
    if (!isUniqueViolation(error)) {
      return error;
    }

    const archivedId = await combos.findArchivedIdByName(foodtruckId, name!);
    const message = `a combo named "${name}" already exists`;

    return new ConflictError(
      archivedId
        ? `${message}, archived; restore it with POST /combos/${archivedId}/restore`
        : message,
    );
  }

  return {
    async list(foodtruckId: string): Promise<Combo[]> {
      return (await combos.list(foodtruckId)).map(toCombo);
    },

    async create(foodtruckId: string, input: ComboInput): Promise<Combo> {
      try {
        return await withTransaction(db, async (tx) => {
          const prices = await checkReferences(
            tx,
            foodtruckId,
            input.components,
          );
          const price =
            input.price_cents ?? suggestion(input.components, prices);
          const repository = makeComboRepository(tx);
          const id = await repository.create(foodtruckId, input.name, price);
          await repository.replaceComponents(id, input.components);

          return toCombo((await repository.findById(id))!);
        });
      } catch (error) {
        throw await translateWriteError(error, foodtruckId, input.name);
      }
    },

    async update(
      foodtruckId: string,
      id: string,
      input: Partial<ComboInput>,
    ): Promise<Combo> {
      try {
        return await withTransaction(db, async (tx) => {
          const repository = makeComboRepository(tx);
          const combo = await repository.lock(id);

          if (!combo || combo.archived) {
            throw new NotFoundError("combo not found");
          }

          if (input.components) {
            await checkReferences(tx, combo.foodtruck_id, input.components);
            await repository.replaceComponents(id, input.components);
          }

          await repository.update(id, input);

          return toCombo((await repository.findById(id))!);
        });
      } catch (error) {
        throw await translateWriteError(error, foodtruckId, input.name);
      }
    },

    async archive(id: string): Promise<void> {
      if (!(await combos.archive(id))) {
        throw new NotFoundError("combo not found");
      }
    },

    async restore(id: string): Promise<Combo> {
      return withTransaction(db, async (tx) => {
        const repository = makeComboRepository(tx);
        const combo = await repository.lock(id);

        if (!combo) {
          throw new NotFoundError("combo not found");
        }

        if (!combo.archived) {
          throw new ConflictError("combo is not archived");
        }

        const { itemIds, swapCategoryIds } = await repository.references(id);
        const items = await makeItemRepository(tx).lockSharedMany(itemIds);
        const categories =
          await makeCategoryRepository(tx).lockSharedMany(swapCategoryIds);
        const blocked = [...items, ...categories]
          .filter((row) => row.archived)
          .map((row) => row.name)
          .sort();

        if (blocked.length > 0) {
          throw new ConflictError(
            `combo cannot be restored while these are archived: ${blocked.join(", ")}`,
          );
        }

        await repository.restore(id);

        return toCombo((await repository.findById(id))!);
      });
    },
  };
}

async function checkReferences(
  tx: PoolClient,
  foodtruckId: string,
  components: ComponentInput[],
): Promise<Map<string, number>> {
  const itemIds = [...new Set(components.map((c) => c.item_id))];
  const items = await makeItemRepository(tx).lockSharedMany(itemIds);
  const prices = new Map(
    items
      .filter((item) => !item.archived && item.foodtruck_id === foodtruckId)
      .map((item) => [item.id, item.price_cents]),
  );
  const missingItems = itemIds.filter((itemId) => !prices.has(itemId));

  if (missingItems.length > 0) {
    throw new UnprocessableError(
      `items ${missingItems.join(", ")} do not exist or are archived`,
    );
  }

  const categoryIds = [
    ...new Set(components.flatMap((c) => c.swap_category_id ?? [])),
  ];
  const categories =
    await makeCategoryRepository(tx).lockSharedMany(categoryIds);
  const live = new Set(
    categories
      .filter(
        (category) =>
          !category.archived && category.foodtruck_id === foodtruckId,
      )
      .map((category) => category.id),
  );
  const missingCategories = categoryIds.filter((id) => !live.has(id));

  if (missingCategories.length > 0) {
    throw new UnprocessableError(
      `swap categories ${missingCategories.join(", ")} do not exist`,
    );
  }

  return prices;
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
    throw new UnprocessableError(
      `the suggested price ${cents} is above the ceiling; set price_cents by hand`,
    );
  }

  return cents;
}

export type ComboService = ReturnType<typeof makeComboService>;
