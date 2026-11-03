import Fastify, { type FastifyServerOptions } from 'fastify'

import { healthRoutes } from './routes/health.ts'

export function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts)

  app.register(healthRoutes)

  return app
}
