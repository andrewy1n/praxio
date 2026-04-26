/**
 * Seed MongoDB with workspaces + main branches from preset folders.
 * Usage: pnpm exec tsx scripts/seed-preset-workspace.ts <sessionId> [preset1 preset2 ...]
 * If no presets are specified, seeds all non-projectile-motion presets.
 */
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'

import type { DesignDoc } from '../src/lib/types'
import { createWorkspaceWithMainBranch } from '../src/lib/workspaceDb'

const ALL_PRESETS = [
  'population-growth',
  'diffusion',
  'elastic-inelastic-collisions',
  'unit-circle',
]

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

async function seedOne(preset: string, sessionId: string) {
  const designPath = join(process.cwd(), 'public', 'presets', preset, 'design-doc.json')
  const simPath = join(process.cwd(), 'public', 'presets', preset, 'sim.js')
  const designDoc = JSON.parse(readFileSync(designPath, 'utf8')) as DesignDoc
  const simCode = readFileSync(simPath, 'utf8')
  const workspaceId = randomUUID()
  await createWorkspaceWithMainBranch({ workspaceId, sessionId, concept: designDoc.concept, designDoc, simCode })
  return { preset, workspaceId, workspaceUrl: `/workspace/${workspaceId}` }
}

async function main() {
  loadEnvLocal()
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing after loading .env.local')
    process.exit(1)
  }

  const sessionId = process.argv[2]?.trim()
  if (!sessionId) {
    console.error('Usage: pnpm exec tsx scripts/seed-preset-workspace.ts <sessionId> [preset1 preset2 ...]')
    console.error('Get your sessionId by running localStorage.getItem("sessionId") in the browser console.')
    process.exit(1)
  }

  const presets = process.argv.slice(3).length > 0 ? process.argv.slice(3) : ALL_PRESETS

  const results = []
  for (const preset of presets) {
    try {
      const result = await seedOne(preset, sessionId)
      results.push({ ok: true, ...result })
      console.log(`✓ ${preset} → ${result.workspaceId}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      results.push({ ok: false, preset, error: msg })
      console.error(`✗ ${preset}: ${msg}`)
    }
  }

  console.log('\n' + JSON.stringify({ sessionId, listUrl: `/api/workspaces?sessionId=${encodeURIComponent(sessionId)}`, results }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
