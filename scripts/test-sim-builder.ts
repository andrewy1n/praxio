/**
 * Run the sim-builder agent against a preset design doc in isolation.
 * Usage: pnpm exec tsx scripts/test-sim-builder.ts [preset-name | path/to/design-doc.json]
 * Default preset: projectile-motion
 *
 * Generates sim code, runs static validation, then behavioral verification,
 * and writes the result to scripts/out/<preset-name>.sim.js.
 */
import { generateText } from 'ai'
import { google } from '@ai-sdk/google'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve, basename } from 'path'

import { buildSimBuilderPrompt } from '../src/lib/prompts'
import { validateSimModule } from '../src/lib/validation'
import { verifySimBehavior, formatVerificationFailures } from '../src/lib/verification'
import type { DesignDoc } from '../src/lib/types'

const arg = process.argv[2] ?? 'projectile-motion'

// If the argument looks like a file path, use it directly; otherwise treat as preset name.
const isPath = arg.startsWith('/') || arg.startsWith('.') || arg.endsWith('.json')
const docPath = isPath
  ? resolve(arg)
  : join(process.cwd(), 'public', 'presets', arg, 'design-doc.json')
const preset = isPath
  ? basename(arg).replace(/\.design-doc\.json$|\.json$/, '')
  : arg

let designDoc: DesignDoc
try {
  designDoc = JSON.parse(readFileSync(docPath, 'utf8')) as DesignDoc
} catch {
  console.error(`Could not read design doc at ${docPath}`)
  process.exit(1)
}

void (async () => {
  console.log(`[sim-builder-test] preset=${preset}  primitive=${designDoc.primitive ?? 'none'}  renderer=${designDoc.renderer}`)
  console.log('[sim-builder-test] building prompt...')

  const simBuilderPrompt = buildSimBuilderPrompt(designDoc, [], '')
  console.log(`[sim-builder-test] prompt length=${simBuilderPrompt.length} chars`)
  console.log('[sim-builder-test] calling model...')

  const model = google('gemma-4-31b-it')
  const { text, usage } = await generateText({
    model,
    system: simBuilderPrompt,
    prompt: 'Generate the simulation module.',
  })

  console.log(`[sim-builder-test] done  tokens_in=${usage.inputTokens}  tokens_out=${usage.outputTokens}`)
  console.log('\n── Generated sim code ──────────────────────────────────────────────\n')
  console.log(text)
  console.log('\n────────────────────────────────────────────────────────────────────\n')

  // ── Static validation ──────────────────────────────────────────────────────
  console.log('[static] running...')
  const staticResult = validateSimModule(text)
  if (staticResult.valid) {
    console.log('[static] PASS')
  } else {
    console.log(`[static] FAIL  (${staticResult.errors.length} error(s))`)
    staticResult.errors.forEach(e => console.log(`  ✘ ${e}`))
  }

  // ── Behavioral verification ────────────────────────────────────────────────
  if (designDoc.verification) {
    console.log(`[behavioral] running ${designDoc.verification.probes.length} probe(s)...`)
    const report = await verifySimBehavior(text, designDoc)

    console.log(`[behavioral] ${report.passed ? 'PASS' : 'FAIL'}`)

    report.probeResults.forEach(pr => {
      const metricStr = Object.entries(pr.metrics).map(([k, v]) => `${k}=${v}`).join('  ') || '(no metrics)'
      console.log(`  probe ${pr.probeId}: ${metricStr}`)
    })

    if (!report.passed) {
      console.log('\n  Failed invariants:')
      formatVerificationFailures(report).forEach(f => console.log(`  ✘ ${f}`))
    } else {
      report.checks.forEach(c => console.log(`  ✔ ${c.invariantId}`))
    }
  } else {
    console.log('[behavioral] skipped (no verification block in design doc)')
  }

  // ── Write output ───────────────────────────────────────────────────────────
  const outDir = join(process.cwd(), 'scripts', 'out')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${preset}.sim.js`)
  writeFileSync(outPath, text, 'utf8')
  console.log(`\n[sim-builder-test] wrote output to ${outPath}`)
})()
