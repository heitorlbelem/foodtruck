import type { FastifyPluginAsync } from "fastify";

import { makeFoodtruckRepository } from "../foodtruck/foodtruck.repository.ts";
import {
  archiveComboSchema,
  createComboSchema,
  listCombosSchema,
  restoreComboSchema,
  updateComboSchema,
} from "./combos.schemas.ts";
import { type ComboInput, makeComboService } from "./combos.service.ts";

type IdParams = { id: string };

export const comboRoutes: FastifyPluginAsync = async (app) => {
  const foodtrucks = makeFoodtruckRepository(app.db);
  const service = makeComboService({ db: app.db });

  app.get("/combos", { schema: listCombosSchema }, async () =>
    service.list(await foodtrucks.currentId()),
  );

  app.post<{ Body: ComboInput }>(
    "/combos",
    { schema: createComboSchema },
    async (request, reply) => {
      const combo = await service.create(
        await foodtrucks.currentId(),
        request.body,
      );

      return reply.code(201).send(combo);
    },
  );

  app.patch<{ Params: IdParams; Body: Partial<ComboInput> }>(
    "/combos/:id",
    { schema: updateComboSchema },
    async (request) =>
      service.update(
        await foodtrucks.currentId(),
        request.params.id,
        request.body,
      ),
  );

  app.delete<{ Params: IdParams }>(
    "/combos/:id",
    { schema: archiveComboSchema },
    async (request, reply) => {
      await service.archive(request.params.id);

      return reply.code(204).send();
    },
  );

  app.post<{ Params: IdParams }>(
    "/combos/:id/restore",
    { schema: restoreComboSchema },
    async (request) => service.restore(request.params.id),
  );
};
