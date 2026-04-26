import { MongoClient, Db } from 'mongodb'

let client: MongoClient
let db: Db
let indexesPromise: Promise<void> | null = null

export async function getDb(): Promise<Db> {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set')
  }
  if (db) return db
  client = new MongoClient(process.env.MONGODB_URI)
  await client.connect()
  db = client.db('praxio')
  return db
}

/**
 * One-time index bootstrap for workspaces / steps (idempotent).
 */
export async function ensurePraxioIndexes(): Promise<void> {
  if (indexesPromise) return indexesPromise
  indexesPromise = (async () => {
    const database = await getDb()
    const workspaces = database.collection('workspaces')
    const steps = database.collection('steps')

    await workspaces.createIndex({ sessionId: 1, lastActiveAt: -1 })
    await workspaces.createIndex({ workspaceId: 1 }, { unique: true })
    await workspaces.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 })

    await steps.createIndex({ workspaceId: 1 })
    await steps.createIndex({ branchId: 1 }, { unique: true })
    await steps.createIndex({ sessionId: 1, workspaceId: 1 })
  })()
  return indexesPromise
}

export function getWorkspacesCollection() {
  return getDb().then(d => d.collection('workspaces'))
}

export function getStepsCollection() {
  return getDb().then(d => d.collection('steps'))
}
