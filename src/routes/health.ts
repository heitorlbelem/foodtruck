import type { FastifyInstance } from 'fastify'

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              updatedAt: { type: 'string' },
            },
          },
        },
      },
    },
    async () => ({ updatedAt: new Date().toISOString() }),
  )
}
