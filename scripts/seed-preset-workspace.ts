/**
 * Seed MongoDB with a workspace + main branch from a preset folder.
 * Usage: pnpm exec tsx scripts/seed-preset-workspace.ts [sessionId]
 * Default sessionId: random (printed on success).
 */
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'

import type { DesignDoc } from '../src/lib/types'
import { createWorkspaceWithMainBranch } from '../src/lib/workspaceDb'

function loadEnvLocal() {
  const envPath = join(process.cwd(), '.env.local')
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}

const preset = 'projectile-motion'

async function main() {
  loadEnvLocal()
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing after loading .env.local')
    process.exit(1)
  }

  const sessionId = process.argv[2]?.trim() || `preset-${randomUUID().slice(0, 8)}`
  const workspaceId = randomUUID()

  const designPath = join(process.cwd(), 'public', 'presets', preset, 'design-doc.json')
  const simPath = join(process.cwd(), 'public', 'presets', preset, 'sim.js')

  const designDoc = JSON.parse(readFileSync(designPath, 'utf8')) as DesignDoc
  const simCode = readFileSync(simPath, 'utf8')

  await createWorkspaceWithMainBranch({
    workspaceId,
    sessionId,
    concept: designDoc.concept,
    designDoc,
    simCode,
  })

  console.log(
    JSON.stringify(
      {
        ok: true,
        preset,
        sessionId,
        workspaceId,
        listUrl: `/api/workspaces?sessionId=${encodeURIComponent(sessionId)}`,
        workspaceUrl: `/workspace/${workspaceId}`,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
