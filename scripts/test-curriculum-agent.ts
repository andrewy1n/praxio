/**
 * Run the curriculum agent in isolation against a free-form concept string.
 * Usage: pnpm exec tsx scripts/test-curriculum-agent.ts [concept]
 * Default concept: "projectile motion"
 *
 * Calls the curriculum agent, validates the output against DesignDocCoreSchema,
 * and writes the result to scripts/out/<slug>.design-doc-core.json.
 */
import { generateText, NoObjectGeneratedError, Output } from 'ai'
import { google } from '@ai-sdk/google'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

import { CURRICULUM_SYSTEM_PROMPT } from '../src/lib/prompts'
import { DesignDocCoreSchema } from '../src/lib/types'
import { validateDesignDocConsistency } from '../src/lib/designDocConsistency'

const concept = process.argv.slice(2).join(' ') || 'projectile motion'
const slug = concept.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

void (async () => {
  console.log(`[curriculum-agent-test] concept="${concept}"`)
  console.log('[curriculum-agent-test] calling model...')

  const model = google('gemini-2.5-flash')

  let core: import('../src/lib/types').DesignDocCore
  try {
    const { output, usage } = await generateText({
      model,
      output: Output.object({ schema: DesignDocCoreSchema }),
      system: CURRICULUM_SYSTEM_PROMPT,
      prompt: concept,
    })
    core = output
    console.log(`[curriculum-agent-test] done  tokens_in=${usage.inputTokens}  tokens_out=${usage.outputTokens}`)
  } catch (e) {
    if (NoObjectGeneratedError.isInstance(e)) {
      console.error('[curriculum-agent-test] FAIL — model did not return a valid object')
      console.error(`  finishReason: ${String(e.finishReason)}`)
      if (e.text) {
        console.error(`  raw model text (${e.text.length} chars):\n${e.text.slice(0, 2000)}`)
      }
    } else {
      console.error('[curriculum-agent-test] FAIL', e)
    }
    process.exit(1)
  }

  console.log('\n── Design doc core ─────────────────────────────────────────────────\n')
  console.log(JSON.stringify(core, null, 2))
  console.log('\n────────────────────────────────────────────────────────────────────\n')

  // ── Consistency check (partial — core has no verification block yet) ──────
  console.log('[consistency] running partial check on core fields...')
  console.log(`  renderer:  ${core.renderer}`)
  console.log(`  domain:    ${core.domain}`)
  console.log(`  primitive: ${core.primitive ?? 'none'}`)
  console.log(`  params:    ${core.params.map(p => p.name).join(', ')}`)
  console.log(`  regions:   ${core.register_regions.join(', ')}`)
  console.log(`  events:    ${core.emit_events.join(', ')}`)
  console.log(`  steps:     ${core.socratic_plan.length}`)

  const paramErrors: string[] = []
  for (const p of core.params) {
    if (p.min >= p.max) paramErrors.push(`${p.name}: min(${p.min}) >= max(${p.max})`)
    if (p.default < p.min || p.default > p.max) paramErrors.push(`${p.name}: default(${p.default}) outside [${p.min},${p.max}]`)
  }

  const interactionErrors: string[] = []
  for (const step of core.socratic_plan) {
    if (typeof step.interaction === 'string') {
      interactionErrors.push(`step ${step.id}: interaction is a bare string — must be object with "kind"`)
    }
  }

  const allCoreErrors = [...paramErrors, ...interactionErrors]
  if (allCoreErrors.length > 0) {
    console.log(`[consistency] FAIL  (${allCoreErrors.length} error(s))`)
    allCoreErrors.forEach(e => console.log(`  ✘ ${e}`))
  } else {
    console.log('[consistency] PASS (core fields OK)')
  }

  // ── Write output ───────────────────────────────────────────────────────────
  const outDir = join(process.cwd(), 'scripts', 'out')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${slug}.design-doc-core.json`)
  writeFileSync(outPath, JSON.stringify(core, null, 2), 'utf8')
  console.log(`\n[curriculum-agent-test] wrote output to ${outPath}`)
})()
