import { Pool } from 'pg'

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required')
  }

  return new Pool({ connectionString })
}
