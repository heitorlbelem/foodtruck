import { afterAll, expect, it } from 'vitest'

import { createPool } from './pool.ts'

const pool = createPool()

afterAll(() => pool.end())

it('connects to the database', async () => {
  const { rows } = await pool.query<{ ok: number }>('select 1 as ok')

  expect(rows[0]?.ok).toBe(1)
})

it('requires DATABASE_URL', () => {
  expect(() => createPool('')).toThrow('DATABASE_URL is required')
})
