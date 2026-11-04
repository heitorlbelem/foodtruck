import type { Pool, PoolClient } from "pg";

import {
  isForeignKeyViolation,
  isUniqueViolation,
} from "../../infra/db/errors.ts";
import { API_V1_PREFIX } from "../../shared/api.ts";
import { withTransaction } from "../../infra/db/transaction.ts";
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from "../../shared/errors.ts";
import { makeAddonRepository } from "../addons/addons.repository.ts";
import { makeCategoryRepository } from "../categories/categories.repository.ts";
import { makeComboRepository } from "../combos/combos.repository.ts";
import {
  type Item,
  type ItemRow,
  makeItemRepository,
} from "./items.repository.ts";

export type ItemInput = {
  category_id: string;
  name: string;
  price_cents: number;
  ingredients?: string[];
  addon_ids?: string[];
};

export function makeItemService({ db }: { db: Pool }) {
  const items = makeItemRepository(db);

  async function translateWriteError(
    error: unknown,
    foodtruckId: string,
    input: Partial<ItemInput>,
  ): Promise<unknown> {
    if (isUniqueViolation(error)) {
      const archivedId = await items.findArchivedIdByName(
        foodtruckId,
        input.name!,
      );
      const message = `an item named "${input.name}" already exists`;

      return archivedId
        ? new ConflictError(
            "NAME_TAKEN_ARCHIVED",
            `${message}, archived; restore it with POST ${API_V1_PREFIX}/items/${archivedId}/restore`,
          )
        : new ConflictError("NAME_TAKEN", message);
    }

    if (isForeignKeyViolation(error)) {
      return new UnprocessableError(
        "INVALID_REFERENCE",
        `category ${input.category_id} does not exist`,
      );
    }

    return error;
  }

  return {
    async create(foodtruckId: string, input: ItemInput): Promise<Item> {
      try {
        return await withTransaction(db, async (tx) => {
          await checkLiveCategory(tx, input.category_id, foodtruckId);

          const item = await makeItemRepository(tx).create(foodtruckId, input);
          await replaceChildren(tx, foodtruckId, item.id, input);

          return readChildren(tx, item);
        });
      } catch (error) {
        throw await translateWriteError(error, foodtruckId, input);
      }
    },

    async update(
      foodtruckId: string,
      id: string,
      input: Partial<ItemInput>,
    ): Promise<Item> {
      try {
        return await withTransaction(db, async (tx) => {
          const updated = await makeItemRepository(tx).update(id, input);

          if (!updated) {
            throw new NotFoundError("ITEM_NOT_FOUND", "item not found");
          }

          const { foodtruck_id, ...item } = updated;

          if (input.category_id) {
            await checkLiveCategory(tx, input.category_id, foodtruck_id);
          }

          await replaceChildren(tx, foodtruck_id, item.id, input);

          return readChildren(tx, item);
        });
      } catch (error) {
        throw await translateWriteError(error, foodtruckId, input);
      }
    },

    async archive(id: string): Promise<void> {
      await withTransaction(db, async (tx) => {
        const repository = makeItemRepository(tx);
        const item = await repository.lock(id);

        if (!item || item.archived) {
          throw new NotFoundError("ITEM_NOT_FOUND", "item not found");
        }

        const combos =
          await makeComboRepository(tx).liveNamesContainingItem(id);

        if (combos.length > 0) {
          throw new ConflictError(
            "IN_USE",
            `item is still used by combos: ${combos.join(", ")}`,
          );
        }

        await repository.archive(id);
      });
    },

    async restore(id: string): Promise<Item> {
      return withTransaction(db, async (tx) => {
        const repository = makeItemRepository(tx);
        const item = await repository.lock(id);

        if (!item) {
          throw new NotFoundError("ITEM_NOT_FOUND", "item not found");
        }

        if (!item.archived) {
          throw new ConflictError("NOT_ARCHIVED", "item is not archived");
        }

        const category = await makeCategoryRepository(tx).lockShared(
          item.category_id,
        );

        if (category!.archived) {
          throw new ConflictError(
            "RESTORE_BLOCKED",
            `item cannot be restored while these are archived: ${category!.name}`,
          );
        }

        return readChildren(tx, await repository.restore(id));
      });
    },
  };
}

async function checkLiveCategory(
  tx: PoolClient,
  categoryId: string,
  foodtruckId: string,
): Promise<void> {
  const category = await makeCategoryRepository(tx).lockShared(categoryId);

  if (!category || category.archived || category.foodtruck_id !== foodtruckId) {
    throw new UnprocessableError(
      "INVALID_REFERENCE",
      `category ${categoryId} does not exist or is archived`,
    );
  }
}

async function replaceChildren(
  tx: PoolClient,
  foodtruckId: string,
  itemId: string,
  input: Partial<ItemInput>,
): Promise<void> {
  const repository = makeItemRepository(tx);

  if (input.ingredients) {
    await repository.replaceIngredients(itemId, input.ingredients);
  }

  if (input.addon_ids) {
    const live = new Set(
      await makeAddonRepository(tx).lockLiveIds(foodtruckId, input.addon_ids),
    );
    const unavailable = input.addon_ids.filter((addonId) => !live.has(addonId));

    if (unavailable.length > 0) {
      throw new UnprocessableError(
        "INVALID_REFERENCE",
        `addons ${unavailable.join(", ")} do not exist or are archived`,
      );
    }

    await repository.replaceAddonLinks(itemId, input.addon_ids);
  }
}

async function readChildren(tx: PoolClient, item: ItemRow): Promise<Item> {
  const repository = makeItemRepository(tx);

  return {
    ...item,
    ingredients: await repository.ingredients(item.id),
    addons: await repository.liveAddons(item.id),
  };
}

export type ItemService = ReturnType<typeof makeItemService>;
