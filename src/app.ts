import Fastify, { type FastifyServerOptions } from 'fastify'
import type { Pool } from 'pg'

import { createPool } from './infra/db/pool.ts'
import { healthRoutes } from './routes/health.ts'

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool
  }
}

export function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts)

  app.decorate('db', createPool())
  app.addHook('onClose', (instance) => instance.db.end())

  app.register(healthRoutes)

  return app
}
