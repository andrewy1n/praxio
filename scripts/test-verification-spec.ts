/**
 * Run the verification-spec agent in isolation against a design doc core.
 * Usage: pnpm exec tsx scripts/test-verification-spec.ts [preset-name | path/to/core.json]
 * Default: reads public/presets/projectile-motion/design-doc.json as the core.
 *
 * Accepts either:
 *   - A preset name (looks up public/presets/<name>/design-doc.json)
 *   - A path to a .design-doc-core.json produced by test-curriculum-agent.ts
 *
 * Calls the verification-spec agent and writes the merged result to
 * scripts/out/<name>.design-doc.json (core + verification block).
 */
import { generateText, NoObjectGeneratedError, Output } from 'ai'
import { google } from '@ai-sdk/google'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { join, extname, basename } from 'path'

import { VERIFICATION_SPEC_SYSTEM_PROMPT } from '../src/lib/prompts'
import {
  DesignDocCoreSchema,
  VerificationBlockRawSchema,
  type DesignDocCore,
  type SocraticStep,
  type VerificationBlock,
} from '../src/lib/types'
import { validateDesignDocConsistency } from '../src/lib/designDocConsistency'

const arg = process.argv[2] ?? 'projectile-motion'

function loadCore(): { core: DesignDocCore; label: string } {
  // If the arg looks like a file path with a known extension, load it directly.
  if (existsSync(arg)) {
    const raw = JSON.parse(readFileSync(arg, 'utf8')) as unknown
    // If it has a verification block already (full design doc), strip it for the core.
    const parsed = DesignDocCoreSchema.safeParse(raw)
    if (!parsed.success) {
      console.error(`Could not parse ${arg} as DesignDocCore: ${parsed.error.message}`)
      process.exit(1)
    }
    const label = basename(arg).replace(/\.json$/, '').replace(/\.design-doc(-core)?$/, '')
    return { core: parsed.data, label }
  }

  // Otherwise treat as a preset name.
  const docPath = join(process.cwd(), 'public', 'presets', arg, 'design-doc.json')
  if (!existsSync(docPath)) {
    console.error(`Could not find design doc at ${docPath}`)
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(docPath, 'utf8')) as unknown
  const parsed = DesignDocCoreSchema.safeParse(raw)
  if (!parsed.success) {
    console.error(`Could not parse ${docPath} as DesignDocCore: ${parsed.error.message}`)
    process.exit(1)
  }
  return { core: parsed.data, label: arg }
}

function listNumericHypothesisMetrics(core: DesignDocCore): string[] {
  return Array.from(
    new Set(
      core.socratic_plan
        .map(step => step.interaction)
        .filter(
          (i): i is Extract<SocraticStep['interaction'], { kind: 'numeric_hypothesis' }> =>
            i.kind === 'numeric_hypothesis',
        )
        .map(i => i.metric.trim())
        .filter(Boolean),
    ),
  )
}

const { core, label } = loadCore()

void (async () => {
  console.log(`[verification-spec-test] preset/label=${label}  primitive=${core.primitive ?? 'none'}  renderer=${core.renderer}`)

  const numericMetrics = listNumericHypothesisMetrics(core)
  const metricPrompt = numericMetrics.length > 0
    ? `\nNUMERIC_HYPOTHESIS_METRICS (must appear in probe expected_metrics): ${numericMetrics.join(', ')}`
    : '\nNUMERIC_HYPOTHESIS_METRICS: none'

  const userPrompt = `DESIGN DOC CORE:\n${JSON.stringify(core, null, 2)}${metricPrompt}`

  console.log(`[verification-spec-test] numeric hypothesis metrics: ${numericMetrics.join(', ') || 'none'}`)
  console.log('[verification-spec-test] calling model...')

  const model = google('gemini-2.5-flash')

  let block: VerificationBlock
  try {
    const { output, usage } = await generateText({
      model,
      output: Output.object({ schema: VerificationBlockRawSchema }),
      system: VERIFICATION_SPEC_SYSTEM_PROMPT,
      prompt: userPrompt,
    })
    // Convert params array → record (mirrors normalizeVerificationBlock in the pipeline)
    const allowedParamNames = new Set(core.params.map(p => p.name))
    block = {
      ...output,
      probes: output.probes.map(probe => ({
        ...probe,
        params: Object.fromEntries(
          probe.params
            .filter(({ name }) => allowedParamNames.has(name))
            .map(({ name, value }) => [name, value]),
        ),
      })),
    }
    console.log(`[verification-spec-test] done  tokens_in=${usage.inputTokens}  tokens_out=${usage.outputTokens}`)
  } catch (e) {
    if (NoObjectGeneratedError.isInstance(e)) {
      console.error('[verification-spec-test] FAIL — model did not return a valid object')
      console.error(`  finishReason: ${String(e.finishReason)}`)
      if (e.text) {
        console.error(`  raw model text (${e.text.length} chars):\n${e.text.slice(0, 2000)}`)
      }
    } else {
      console.error('[verification-spec-test] FAIL', e)
    }
    process.exit(1)
  }

  console.log('\n── Verification block ──────────────────────────────────────────────\n')
  console.log(JSON.stringify(block, null, 2))
  console.log('\n────────────────────────────────────────────────────────────────────\n')

  // ── Probe summary ──────────────────────────────────────────────────────────
  console.log(`[probes] ${block.probes.length} probe(s):`)
  block.probes.forEach(p => {
    const params = Object.entries(p.params).map(([k, v]) => `${k}=${v}`).join(', ')
    console.log(`  ${p.id}: params={${params}}  metrics=[${p.expected_metrics.join(', ')}]`)
  })

  console.log(`\n[invariants] ${block.invariants.length} invariant(s):`)
  block.invariants.forEach(inv => console.log(`  ${inv.id} (${inv.kind}): ${inv.description}`))

  // ── Metric coverage check ──────────────────────────────────────────────────
  if (numericMetrics.length > 0) {
    const coveredMetrics = new Set(block.probes.flatMap(p => p.expected_metrics))
    const missing = numericMetrics.filter(m => !coveredMetrics.has(m))
    if (missing.length > 0) {
      console.log(`\n[metric-coverage] FAIL — missing numeric hypothesis metrics in probes: ${missing.join(', ')}`)
    } else {
      console.log('\n[metric-coverage] PASS — all numeric hypothesis metrics covered')
    }
  }

  // ── Consistency check on merged doc ───────────────────────────────────────
  const merged = { ...core, verification: block }
  const consistency = validateDesignDocConsistency(merged as import('../src/lib/types').DesignDoc)
  if (consistency.valid) {
    console.log('[consistency] PASS')
  } else {
    console.log(`[consistency] FAIL  (${consistency.errors.length} error(s))`)
    consistency.errors.forEach(e => console.log(`  ✘ ${e.path}: ${e.message}`))
  }

  // ── Write output ───────────────────────────────────────────────────────────
  const outDir = join(process.cwd(), 'scripts', 'out')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${label}.design-doc.json`)
  writeFileSync(outPath, JSON.stringify(merged, null, 2), 'utf8')
  console.log(`\n[verification-spec-test] wrote output to ${outPath}`)
})()
