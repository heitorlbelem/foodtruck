import type { FastifyInstance } from "fastify";

import { archivedIdNamed, type RestoreResult } from "../catalog/archived.ts";
import { makeFoodtruckRepository } from "../modules/foodtruck/foodtruck.repository.ts";
import { conflict, notFound } from "./http-errors.ts";
import { idParams } from "../shared/schemas.ts";

type Table = "categories" | "items" | "addons" | "combos";

export async function nameTaken(
  app: FastifyInstance,
  table: Table,
  message: string,
  name: string | undefined,
): Promise<Error> {
  const archivedId =
    name === undefined
      ? undefined
      : await archivedIdNamed(
          app.db,
          table,
          await makeFoodtruckRepository(app.db).currentId(),
          name,
        );

  return conflict(
    archivedId
      ? `${message}, archived; restore it with POST /${table}/${archivedId}/restore`
      : message,
  );
}

export function restoreRoute<T>(
  app: FastifyInstance,
  options: {
    table: Table;
    noun: string;
    schema: object;
    restore: (
      db: FastifyInstance["db"],
      id: string,
    ) => Promise<RestoreResult<T>>;
  },
) {
  app.post<{ Params: { id: string } }>(
    `/${options.table}/:id/restore`,
    { schema: { params: idParams, response: { 200: options.schema } } },
    async (request) => {
      const result = await options.restore(app.db, request.params.id);

      switch (result.status) {
        case "not_found":
          throw notFound(`${options.noun} not found`);
        case "not_archived":
          throw conflict(`${options.noun} is not archived`);
        case "blocked":
          throw conflict(
            `${options.noun} cannot be restored while these are archived: ${result.blocked_by.join(", ")}`,
          );
        case "restored":
          return result.row;
      }
    },
  );
}
