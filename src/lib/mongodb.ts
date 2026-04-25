import { MongoClient, Db } from 'mongodb'

let client: MongoClient
let db: Db

export async function getDb(): Promise<Db> {
  if (db) return db
  client = new MongoClient(process.env.MONGODB_URI!)
  await client.connect()
  db = client.db('praxio')
  return db
}
