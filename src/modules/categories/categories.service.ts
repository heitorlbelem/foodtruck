import type { Pool } from "pg";

import { isUniqueViolation } from "../../infra/db/errors.ts";
import { withTransaction } from "../../infra/db/transaction.ts";
import { ConflictError, NotFoundError } from "../../shared/errors.ts";
import { makeComboRepository } from "../combos/combos.repository.ts";
import { makeItemRepository } from "../items/items.repository.ts";
import {
  type Category,
  makeCategoryRepository,
} from "./categories.repository.ts";

type CategoryInput = { name: string; sort_order?: number };

export function makeCategoryService({ db }: { db: Pool }) {
  const categories = makeCategoryRepository(db);

  async function nameTaken(foodtruckId: string, name: string) {
    const archivedId = await categories.findArchivedIdByName(foodtruckId, name);
    const message = `a category named "${name}" already exists`;

    return new ConflictError(
      archivedId
        ? `${message}, archived; restore it with POST /categories/${archivedId}/restore`
        : message,
    );
  }

  return {
    async create(foodtruckId: string, input: CategoryInput): Promise<Category> {
      try {
        return await categories.create(foodtruckId, input);
      } catch (error) {
        throw isUniqueViolation(error)
          ? await nameTaken(foodtruckId, input.name)
          : error;
      }
    },

    async update(
      foodtruckId: string,
      id: string,
      input: Partial<CategoryInput>,
    ): Promise<Category> {
      let category: Category | undefined;

      try {
        category = await categories.update(id, input);
      } catch (error) {
        throw isUniqueViolation(error)
          ? await nameTaken(foodtruckId, input.name!)
          : error;
      }

      if (!category) {
        throw new NotFoundError("category not found");
      }

      return category;
    },

    async archive(id: string): Promise<void> {
      await withTransaction(db, async (tx) => {
        const category = await makeCategoryRepository(tx).lock(id);

        if (!category || category.archived) {
          throw new NotFoundError("category not found");
        }

        const items = await makeItemRepository(tx).liveNamesInCategory(id);
        const combos =
          await makeComboRepository(tx).liveNamesWithSwapCategory(id);

        if (items.length > 0 || combos.length > 0) {
          const holders = [
            ...(items.length > 0 ? [`items: ${items.join(", ")}`] : []),
            ...(combos.length > 0 ? [`combos: ${combos.join(", ")}`] : []),
          ];

          throw new ConflictError(
            `category "${category.name}" is still used by ${holders.join("; ")}`,
          );
        }

        await makeCategoryRepository(tx).archive(id);
      });
    },

    async restore(id: string): Promise<Category> {
      return withTransaction(db, async (tx) => {
        const repository = makeCategoryRepository(tx);
        const category = await repository.lock(id);

        if (!category) {
          throw new NotFoundError("category not found");
        }

        if (!category.archived) {
          throw new ConflictError("category is not archived");
        }

        return repository.restore(id);
      });
    },
  };
}

export type CategoryService = ReturnType<typeof makeCategoryService>;
