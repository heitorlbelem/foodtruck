import type { Pool } from "pg";

import { isUniqueViolation } from "../../infra/db/errors.ts";
import { API_V1_PREFIX } from "../../shared/api.ts";
import { withTransaction } from "../../infra/db/transaction.ts";
import { ConflictError, NotFoundError } from "../../shared/errors.ts";
import { makeItemRepository } from "../items/items.repository.ts";
import {
  type Addon,
  type AddonInput,
  makeAddonRepository,
} from "./addons.repository.ts";

export function makeAddonService({ db }: { db: Pool }) {
  const addons = makeAddonRepository(db);

  async function nameTaken(foodtruckId: string, name: string) {
    const archivedId = await addons.findArchivedIdByName(foodtruckId, name);
    const message = `an addon named "${name}" already exists`;

    return archivedId
      ? new ConflictError(
          "NAME_TAKEN_ARCHIVED",
          `${message}, archived; restore it with POST ${API_V1_PREFIX}/addons/${archivedId}/restore`,
        )
      : new ConflictError("NAME_TAKEN", message);
  }

  return {
    async create(foodtruckId: string, input: AddonInput): Promise<Addon> {
      try {
        return await addons.create(foodtruckId, input);
      } catch (error) {
        throw isUniqueViolation(error)
          ? await nameTaken(foodtruckId, input.name)
          : error;
      }
    },

    async update(
      foodtruckId: string,
      id: string,
      input: Partial<AddonInput>,
    ): Promise<Addon> {
      let addon: Addon | undefined;

      try {
        addon = await addons.update(id, input);
      } catch (error) {
        throw isUniqueViolation(error)
          ? await nameTaken(foodtruckId, input.name!)
          : error;
      }

      if (!addon) {
        throw new NotFoundError("ADDON_NOT_FOUND", "addon not found");
      }

      return addon;
    },

    async archive(id: string): Promise<void> {
      await withTransaction(db, async (tx) => {
        const repository = makeAddonRepository(tx);
        const addon = await repository.lock(id);

        if (!addon || addon.archived) {
          throw new NotFoundError("ADDON_NOT_FOUND", "addon not found");
        }

        const items = await makeItemRepository(tx).liveNamesAcceptingAddon(id);

        if (items.length > 0) {
          throw new ConflictError(
            "IN_USE",
            `addon is still used by items: ${items.join(", ")}`,
          );
        }

        await repository.archive(id);
      });
    },

    async restore(id: string): Promise<Addon> {
      return withTransaction(db, async (tx) => {
        const repository = makeAddonRepository(tx);
        const addon = await repository.lock(id);

        if (!addon) {
          throw new NotFoundError("ADDON_NOT_FOUND", "addon not found");
        }

        if (!addon.archived) {
          throw new ConflictError("NOT_ARCHIVED", "addon is not archived");
        }

        return repository.restore(id);
      });
    },
  };
}

export type AddonService = ReturnType<typeof makeAddonService>;
