import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDatabase, createTestCache, type TestDatabase, type TestCache } from './testDatabase.js'
import { runMigration } from '../../src/migrations/runner.js'

// We need to define these variables here so they are available in the test scope
let db: TestDatabase
let cache: TestCache

// We mock the pool and cache after setting up the environment in beforeAll
// or we can use dynamic imports inside the tests.
// For integration tests, dynamic imports are often cleaner for singletons.

// Mock Horizon Stream
const streamState = {
  onmessage: undefined as undefined | ((op: any) => Promise<void>),
}

vi.mock('@stellar/stellar-sdk', () => {
  class ServerMock {
    operations() {
      return {
        forAsset: () => ({
          cursor: () => ({
            stream: ({ onmessage }: { onmessage: (op: any) => Promise<void> }) => {
              streamState.onmessage = onmessage
            },
          }),
        }),
      }
    }
  }

  return { Horizon: { Server: ServerMock } }
})

describe('E2E State Sync Integration: Horizon -> DB -> Trust -> Cache', () => {
  beforeAll(async () => {
    // 1. Start Postgres and Redis containers
    db = await createTestDatabase()
    cache = await createTestCache()

    // 2. Point current pool and cache to our test containers
    process.env.DB_URL = db.connectionString
    process.env.REDIS_URL = cache.connectionString

    // 3. Run migrations on the test database
    const migrationResult = await runMigration({
      direction: 'up',
      config: {
        databaseUrl: db.connectionString,
        migrationsDir: 'src/migrations',
        migrationsTable: 'pgmigrations',
        migrationsSchema: 'public',
        createSchema: true,
        transactional: true,
      },
      skipPreflight: true,
    })

    if (!migrationResult.success) {
      throw new Error(`Migrations failed: ${migrationResult.error}`)
    }
  }, 60000)

  afterAll(async () => {
    if (db) await db.close()
    if (cache) await cache.close()
  })

  it('syncs a Horizon bond event to the database and reflects in trust score', async () => {
    // Dynamic imports to ensure singletons pull correct env vars
    const { subscribeBondCreationEvents } = await import('../../src/listeners/horizonBondEvents.js')
    const { getTrustScore } = await import('../../src/services/reputationService.js')

    const address = 'GABC123EXAMPLE'
    const bondId = 'bond_xyz'
    const amount = '2000000000000000000' // 2 ETH in wei
    const duration = '365'

    // 1. Subscribe to events
    subscribeBondCreationEvents()

    // 2. Simulate a Horizon event
    if (!streamState.onmessage) {
        throw new Error('Stream not initialized')
    }

    await streamState.onmessage({
      type: 'create_bond',
      source_account: address,
      id: bondId,
      amount: amount,
      duration: duration,
      paging_token: '12345',
    })

    // 3. Verify Database Persistence (Identities)
    const { rows } = await db.pool.query('SELECT * FROM identities WHERE address = $1', [address])
    expect(rows).toHaveLength(1)
    expect(rows[0].bonded_amount).toBe(amount)
    expect(rows[0].active).toBe(true)

    // 4. Verify Trust Score Endpoint (via service)
    const trustScore = await getTrustScore(address)
    expect(trustScore).not.toBeNull()
    expect(trustScore?.score).toBe(50)

    // 5. Verify Cache Population
    const cachedScore = await cache.client.get(`trust:${address.toLowerCase()}`)
    expect(cachedScore).not.toBeNull()
    const parsedCache = JSON.parse(cachedScore!)
    expect(parsedCache.score).toBe(50)

    // 6. Simulate an update (duplicate or new amount) and verify Cache Invalidation
    const newAmount = '3000000000000000000' // 3 ETH
    await streamState.onmessage({
      type: 'create_bond',
      source_account: address,
      id: 'bond_new',
      amount: newAmount,
      duration: duration,
      paging_token: '12346',
    })

    // Cache should be invalidated (deleted)
    const cachedScoreAfter = await cache.client.get(`trust:${address.toLowerCase()}`)
    expect(cachedScoreAfter).toBeNull()

    // Fetching again should return the updated score
    const updatedTrustScore = await getTrustScore(address)
    expect(updatedTrustScore?.score).toBe(50)
  })

  it('handles idempotency (duplicate events)', async () => {
    const { subscribeBondCreationEvents } = await import('../../src/listeners/horizonBondEvents.js')
    
    const address = 'GDUP123EXAMPLE'
    const bondId = 'bond_dup'
    
    subscribeBondCreationEvents()

    const event = {
      type: 'create_bond',
      source_account: address,
      id: bondId,
      amount: '1000',
      duration: '10',
      paging_token: 'token_dup',
    }

    await streamState.onmessage!(event)
    await streamState.onmessage!(event)

    const { rows } = await db.pool.query('SELECT COUNT(*) FROM identities WHERE address = $1', [address])
    expect(rows[0].count).toBe('1')
  })

  it('returns 404/null for missing identity', async () => {
    const { getTrustScore } = await import('../../src/services/reputationService.js')
    const trustScore = await getTrustScore('GNOTFOUND')
    expect(trustScore).toBeNull()
  })
})
