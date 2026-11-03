import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../app.ts'

describe('GET /health', () => {
  const app = buildApp()

  beforeAll(() => app.ready())
  afterAll(() => app.close())

  it('responds with 200 and json', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
  })

  it('returns only the last health update date', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    const body = response.json()

    expect(Object.keys(body)).toEqual(['updatedAt'])
    expect(new Date(body.updatedAt).toISOString()).toBe(body.updatedAt)
  })

  it('refreshes the date on every request', async () => {
    const first = await app.inject({ method: 'GET', url: '/health' })
    await new Promise((resolve) => setTimeout(resolve, 2))
    const second = await app.inject({ method: 'GET', url: '/health' })

    expect(second.json().updatedAt >= first.json().updatedAt).toBe(true)
  })
})
