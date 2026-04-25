import { generateText, NoObjectGeneratedError, Output } from 'ai'
import { google } from '@ai-sdk/google'

import {
  buildSimBuilderPrompt,
  CURRICULUM_SYSTEM_PROMPT,
  VERIFICATION_SPEC_SYSTEM_PROMPT,
} from '@/lib/prompts'
import { runVerificationInvariantSelfCheck } from '@/lib/verificationInvariantSelfCheck'
import {
  DesignDocCoreSchema,
  DesignDocSchema,
  VerificationBlockRawSchema,
  type DesignDoc,
  type DesignDocCore,
  type GenerateErrorResponse,
  type GenerateResponse,
  type CurriculumAgentDiagnosis,
  type VerificationBlock,
  type VerificationBlockRaw,
  type GenerateProgressStepId,
  type VerificationReport,
  type SocraticStep,
} from '@/lib/types'
import {
  diagnoseCurriculumAgentModelText,
  diagnoseVerificationSpecAgentModelText,
} from '@/lib/curriculumAgentDebug'
import { validateDesignDocConsistency } from '@/lib/designDocConsistency'
import { validateSimModule } from '@/lib/validation'
import { formatVerificationFailures, verifySimBehavior } from '@/lib/verification'
import { loadTemplateByDomain } from '@/lib/templateRegistry'

const genModel = google('gemma-4-31b-it')

const MAX_CURRICULUM_VERIFICATION_ROUNDS = 3
const MAX_STATIC_VALIDATION_ATTEMPTS = 3
const MAX_BEHAVIORAL_ROUNDS = 3

const SIM_BUILDER_TEXT_TRACE_MAX = 14_000

type LogModelKind = 'curriculum' | 'verificationSpec' | 'simBuilder'

function logGenerationMaxChars(): number {
  const raw = process.env.PRAXIO_LOG_GENERATION_MAX_CHARS
  if (raw == null || raw === '') return 1_000_000
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 1_000_000
}

function logGenerationModelOutput(
  kind: LogModelKind,
  attempt: number,
  label: string,
  body: string,
): void {
  const max = logGenerationMaxChars()
  const len = body.length
  const truncated = len > max
  const shown = truncated ? body.slice(0, max) : body
  const suffix = truncated
    ? `\n[praxio:generation] truncated: ${len} total chars (raise PRAXIO_LOG_GENERATION_MAX_CHARS)\n`
    : ''
  console.log(
    `[praxio:generation] ${kind} ${label} (attempt ${attempt}, ${len} chars)${truncated ? ' TRUNCATED' : ''}\n---\n${
      shown
    }${suffix}---`,
  )
}

function simBuilderSnippetForTrace(text: string): {
  charCount: number
  truncated: boolean
  text: string
} {
  const charCount = text.length
  if (charCount <= SIM_BUILDER_TEXT_TRACE_MAX) {
    return { charCount, truncated: false, text }
  }
  return {
    charCount,
    truncated: true,
    text: text.slice(0, SIM_BUILDER_TEXT_TRACE_MAX),
  }
}

function traceForConsoleLog(t: GenerationTrace): Record<string, unknown> {
  return {
    ...t,
    attempts: t.attempts.map((a) => {
      if (!a.simBuilderModelOutput) return a
      return {
        ...a,
        simBuilderModelOutput: {
          charCount: a.simBuilderModelOutput.charCount,
          truncated: a.simBuilderModelOutput.truncated,
        },
      }
    }),
  }
}

function summarizeErrors(errors: string[], max = 3): string {
  if (errors.length === 0) return 'unknown error'
  const shown = errors.slice(0, max).join(' | ')
  return errors.length > max ? `${shown} | (+${errors.length - max} more)` : shown
}

export type GenerationAttemptPhase =
  | 'curriculumAgent'
  | 'verificationSpecAgent'
  | 'designDocConsistency'
  | 'simBuilderAgent'
  | 'staticValidation'
  | 'behavioralVerification'
  | 'fallback'
  | 'template'

export type GenerationAttemptTrace = {
  phase: GenerationAttemptPhase
  attempt: number
  startedAt: number
  endedAt: number
  ok: boolean
  errors?: string[]
  /** Raw sim-builder model output for static validation attempts. */
  simBuilderModelOutput?: {
    charCount: number
    truncated: boolean
    text: string
  }
  /** simBuilderAgent only: first full generation vs repair iteration. */
  simBuilderStrategy?: 'fresh' | 'repair'
}

export type GenerationTrace = {
  concept: string
  selectedRenderer?: DesignDoc['renderer']
  attempts: GenerationAttemptTrace[]
  staticValidationRetries: number
  behavioralVerificationRetries: number
  simBuilderGenerationCount: number
  fromTemplate: boolean
  templateId?: string
}

export type GenerationPipelineSuccess = GenerateResponse & { trace: GenerationTrace }

export class GenerationFailedError extends Error {
  constructor(public readonly body: GenerateErrorResponse) {
    super(body.error)
    this.name = 'GenerationFailedError'
  }
}

export type RunGenerationPipelineOptions = {
  debug?: boolean
  logGenerationIo?: boolean
  onAttempt?: (attempt: GenerationAttemptTrace, trace: GenerationTrace) => void
  onProgress?: (event: import('@/lib/types').GenerateStreamEvent) => void
}

function emitProgress(
  onProgress: RunGenerationPipelineOptions['onProgress'],
  e: { step: GenerateProgressStepId; subStep?: 'model' | 'static'; type: 'started' | 'completed' | 'failed'; ok?: boolean; attempt?: number; error?: string; willRetry?: boolean; detail?: string },
): void {
  if (!onProgress) return
  if (e.type === 'started') {
    onProgress({ type: 'progress_step_started', step: e.step, subStep: e.subStep, attempt: e.attempt })
  } else if (e.type === 'completed') {
    onProgress({ type: 'progress_step_completed', step: e.step, subStep: e.subStep, ok: e.ok ?? true, attempt: e.attempt, detail: e.detail })
  } else {
    onProgress({ type: 'progress_step_failed', step: e.step, error: e.error ?? 'failed', willRetry: e.willRetry ?? false })
  }
}

function pushAttempt(
  trace: GenerationTrace,
  partial: Omit<GenerationAttemptTrace, 'startedAt' | 'endedAt'> & { startedAt?: number; endedAt?: number },
  onAttempt?: (attempt: GenerationAttemptTrace, trace: GenerationTrace) => void,
): void {
  const startedAt = partial.startedAt ?? Date.now()
  const endedAt = partial.endedAt ?? Date.now()
  const attempt: GenerationAttemptTrace = {
    ...partial,
    startedAt,
    endedAt,
  }
  trace.attempts.push(attempt)
  onAttempt?.(attempt, trace)
}

function mergeDesignDoc(core: DesignDocCore, block: VerificationBlock): DesignDoc {
  const merged = { ...core, verification: block }
  const parsed = DesignDocSchema.safeParse(merged)
  if (!parsed.success) {
    throw new Error(`Merged design doc failed schema: ${parsed.error.message}`)
  }
  return parsed.data
}

function listNumericHypothesisMetrics(core: DesignDocCore): string[] {
  return Array.from(
    new Set(
      core.socratic_plan
        .map((step) => step.interaction)
        .filter(
          (
            interaction,
          ): interaction is Extract<SocraticStep['interaction'], { kind: 'numeric_hypothesis' }> =>
            interaction.kind === 'numeric_hypothesis',
        )
        .map(interaction => interaction.metric.trim())
        .filter(Boolean),
    ),
  )
}

function normalizeVerificationBlock(
  core: DesignDocCore,
  raw: VerificationBlockRaw,
): VerificationBlock {
  const numericMetrics = listNumericHypothesisMetrics(core)
  const allowedParamNames = new Set(core.params.map(param => param.name))

  const probes = raw.probes.map((probe) => {
    // Convert params array → record, dropping any entries with unknown param names.
    const params: Record<string, number> = {}
    for (const { name, value } of probe.params) {
      if (allowedParamNames.has(name)) {
        params[name] = value
      }
    }

    const existingMetrics = probe.expected_metrics.map(m => m.trim()).filter(Boolean)
    const expected_metrics = Array.from(new Set([...existingMetrics, ...numericMetrics]))

    return { ...probe, params, expected_metrics }
  })

  return { ...raw, probes }
}

async function applyTemplateFallback(
  domain: DesignDoc['domain'],
  trace: GenerationTrace,
  reason: string,
  onAttempt?: (attempt: GenerationAttemptTrace, trace: GenerationTrace) => void,
  onProgress?: (event: import('@/lib/types').GenerateStreamEvent) => void,
): Promise<{
  designDoc: DesignDoc
  simCode: string
  verification: VerificationReport
}> {
  emitProgress(onProgress, { type: 'started', step: 'fallback' })
  const loaded = await loadTemplateByDomain(domain)
  if (!loaded) {
    emitProgress(onProgress, { type: 'failed', step: 'fallback', error: 'no template', willRetry: false })
    throw new GenerationFailedError({
      error: `No template available for domain "${domain}" (${reason})`,
      phase: 'template',
    })
  }

  const consistency = validateDesignDocConsistency(loaded.designDoc)
  if (!consistency.valid) {
    emitProgress(onProgress, { type: 'failed', step: 'fallback', error: 'template consistency', willRetry: false })
    throw new GenerationFailedError({
      error: 'Template design doc failed consistency validation',
      phase: 'template',
      consistencyErrors: consistency.errors,
    })
  }

  const t0 = Date.now()
  const verification = await verifySimBehavior(loaded.simCode, loaded.designDoc)
  pushAttempt(trace, {
    phase: 'fallback',
    attempt: 1,
    startedAt: t0,
    endedAt: Date.now(),
    ok: verification.passed,
    errors: verification.passed
      ? undefined
      : verification.checks.filter(c => !c.passed).map(c => c.message),
  }, onAttempt)

  if (!verification.passed) {
    emitProgress(onProgress, { type: 'failed', step: 'fallback', error: 'template verification failed', willRetry: false })
    throw new GenerationFailedError({
      error: 'Template sim failed behavioral verification',
      phase: 'template',
      verification,
    })
  }

  trace.fromTemplate = true
  trace.templateId = loaded.id
  emitProgress(onProgress, { type: 'completed', step: 'fallback', ok: true })
  return {
    designDoc: loaded.designDoc,
    simCode: loaded.simCode,
    verification,
  }
}

export async function runGenerationPipeline(
  concept: string,
  options?: RunGenerationPipelineOptions,
): Promise<GenerationPipelineSuccess> {
  const logIo
    = options?.logGenerationIo === true
      || process.env.PRAXIO_LOG_GENERATION_IO === '1'
  const onProgress = options?.onProgress
  const trace: GenerationTrace = {
    concept,
    attempts: [],
    staticValidationRetries: 0,
    behavioralVerificationRetries: 0,
    simBuilderGenerationCount: 0,
    fromTemplate: false,
  }

  let designDoc: DesignDoc | null = null
  let lastCurriculumMessage = ''
  let lastCurriculumDiagnosis: CurriculumAgentDiagnosis = { zodIssues: [] }
  let lastVerSpecMessage = ''
  let lastVerSpecDiagnosis: CurriculumAgentDiagnosis = { zodIssues: [] }
  let lastConsistencyErrors: Array<{ path: string; message: string }> = []
  let lastCombinedHint = ''
  let simBuilderExtraHint = ''
  let designDocReady = false

  for (let round = 1; round <= MAX_CURRICULUM_VERIFICATION_ROUNDS; round++) {
    const t0 = Date.now()
    const retryBlock
      = round > 1
        ? `\n\nYour previous output failed: ${lastCurriculumMessage || lastVerSpecMessage || 'validation failed'}${lastCombinedHint}\nRegenerate. Curriculum: interaction must be an object with "kind". Each param: range [min,max], min < max. Domains: physics|math|biology|chemistry|general. Renderers: p5|canvas2d|jsxgraph|matter.`
        : ''
    let core: DesignDocCore | null = null

    emitProgress(onProgress, { type: 'started', step: 'curriculum', attempt: round })
    try {
      const curriculum = await generateText({
        model: genModel,
        output: Output.object({ schema: DesignDocCoreSchema }),
        system: CURRICULUM_SYSTEM_PROMPT,
        prompt: `${concept}${retryBlock}`,
      })
      core = curriculum.output
      if (logIo) {
        if (curriculum.text && curriculum.text.length > 0) {
          logGenerationModelOutput('curriculum', round, 'raw_model_text', curriculum.text)
        } else {
          console.log(
            `[praxio:generation] curriculum attempt ${round}: raw_model_text empty (structured output only)`,
          )
        }
        logGenerationModelOutput('curriculum', round, 'parsed_core_json', JSON.stringify(core, null, 2))
      }
      trace.selectedRenderer = core.renderer
      pushAttempt(trace, {
        phase: 'curriculumAgent',
        attempt: round,
        startedAt: t0,
        endedAt: Date.now(),
        ok: true,
      }, options?.onAttempt)
      emitProgress(onProgress, { type: 'completed', step: 'curriculum', ok: true, attempt: round })
    } catch (e) {
      if (e instanceof GenerationFailedError) throw e
      lastCurriculumMessage = e instanceof Error ? e.message : 'curriculum failed'
      if (NoObjectGeneratedError.isInstance(e) && e.text?.length) {
        lastCurriculumMessage = `${lastCurriculumMessage} (model text ${e.text.length} chars, finish: ${String(e.finishReason)})`
      }

      const baseDiag = NoObjectGeneratedError.isInstance(e)
        ? diagnoseCurriculumAgentModelText(e.text)
        : { zodIssues: [] as CurriculumAgentDiagnosis['zodIssues'] }
      lastCurriculumDiagnosis
        = options?.debug && NoObjectGeneratedError.isInstance(e) && e.text
          ? { ...baseDiag, textPreview: e.text.slice(0, 1500) }
          : baseDiag

      const hint
        = lastCurriculumDiagnosis.parseError
          ?? (lastCurriculumDiagnosis.zodIssues[0]
            && `${lastCurriculumDiagnosis.zodIssues[0].path}: ${lastCurriculumDiagnosis.zodIssues[0].message}`)
          ?? (lastCurriculumDiagnosis.localSchemaOk ? 'local Zod OK — provider/SDK mismatch' : null)
      if (hint) console.warn(`[curriculumAgent] attempt ${round} — ${hint}`)

      if (logIo && NoObjectGeneratedError.isInstance(e) && typeof e.text === 'string' && e.text.length > 0) {
        logGenerationModelOutput('curriculum', round, 'raw_model_text_FAILED', e.text)
      }

      pushAttempt(trace, {
        phase: 'curriculumAgent',
        attempt: round,
        startedAt: t0,
        endedAt: Date.now(),
        ok: false,
        errors: [lastCurriculumMessage],
      }, options?.onAttempt)
      emitProgress(onProgress, { type: 'failed', step: 'curriculum', error: lastCurriculumMessage, willRetry: round < MAX_CURRICULUM_VERIFICATION_ROUNDS })
      if (round === MAX_CURRICULUM_VERIFICATION_ROUNDS) {
        throw new GenerationFailedError({
          error: lastCurriculumMessage,
          phase: 'curriculumAgent',
          ...(options?.debug
            ? { curriculumAgentDiagnosis: lastCurriculumDiagnosis }
            : {}),
        })
      }
      continue
    }

    if (!core) continue

    const tV0 = Date.now()
    const verHint = lastVerSpecMessage
      ? `\n\nFix verification output: ${lastVerSpecMessage}`
      : ''
    const numericMetricList = listNumericHypothesisMetrics(core)
    const metricRequirementPrompt = numericMetricList.length > 0
      ? `\nNUMERIC_HYPOTHESIS_METRICS (must appear in probe expected_metrics): ${numericMetricList.join(', ')}`
      : '\nNUMERIC_HYPOTHESIS_METRICS: none'
    emitProgress(onProgress, { type: 'started', step: 'verificationSpec', attempt: round })
    let block: VerificationBlock
    try {
      const vout = await generateText({
        model: genModel,
        output: Output.object({ schema: VerificationBlockRawSchema }),
        system: VERIFICATION_SPEC_SYSTEM_PROMPT,
        prompt: `DESIGN DOC CORE:\n${JSON.stringify(core, null, 2)}${metricRequirementPrompt}${verHint}`,
      })
      block = normalizeVerificationBlock(core, vout.output)
      if (logIo) {
        if (vout.text && vout.text.length > 0) {
          logGenerationModelOutput('verificationSpec', round, 'raw_model_text', vout.text)
        }
        logGenerationModelOutput('verificationSpec', round, 'parsed_block_json', JSON.stringify(block, null, 2))
      }
      lastVerSpecMessage = ''
      lastVerSpecDiagnosis = { zodIssues: [] }
      pushAttempt(trace, {
        phase: 'verificationSpecAgent',
        attempt: round,
        startedAt: tV0,
        endedAt: Date.now(),
        ok: true,
      }, options?.onAttempt)
      emitProgress(onProgress, { type: 'completed', step: 'verificationSpec', ok: true, attempt: round })
    } catch (e) {
      if (e instanceof GenerationFailedError) throw e
      lastVerSpecMessage = e instanceof Error ? e.message : 'verification spec failed'
      if (NoObjectGeneratedError.isInstance(e) && e.text?.length) {
        lastVerSpecMessage = `${lastVerSpecMessage} (model text ${e.text.length} chars, finish: ${String(e.finishReason)})`
      }
      lastVerSpecDiagnosis
        = options?.debug && NoObjectGeneratedError.isInstance(e) && e.text
          ? { ...diagnoseVerificationSpecAgentModelText(e.text), textPreview: e.text.slice(0, 1500) }
          : diagnoseVerificationSpecAgentModelText(NoObjectGeneratedError.isInstance(e) ? e.text : undefined)

      pushAttempt(trace, {
        phase: 'verificationSpecAgent',
        attempt: round,
        startedAt: tV0,
        endedAt: Date.now(),
        ok: false,
        errors: [lastVerSpecMessage],
      }, options?.onAttempt)
      emitProgress(onProgress, { type: 'failed', step: 'verificationSpec', error: lastVerSpecMessage, willRetry: round < MAX_CURRICULUM_VERIFICATION_ROUNDS })
      if (round === MAX_CURRICULUM_VERIFICATION_ROUNDS) {
        throw new GenerationFailedError({
          error: lastVerSpecMessage,
          phase: 'verificationSpecAgent',
          ...(options?.debug ? { verificationSpecAgentDiagnosis: lastVerSpecDiagnosis } : {}),
        })
      }
      lastCombinedHint = lastVerSpecMessage
      continue
    }

    let merged: DesignDoc
    try {
      merged = mergeDesignDoc(core, block)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'merge failed'
      lastVerSpecMessage = msg
      emitProgress(onProgress, { type: 'failed', step: 'verificationSpec', error: msg, willRetry: round < MAX_CURRICULUM_VERIFICATION_ROUNDS })
      if (round === MAX_CURRICULUM_VERIFICATION_ROUNDS) {
        throw new GenerationFailedError({
          error: msg,
          phase: 'verificationSpecAgent',
        })
      }
      continue
    }

    const tC0 = Date.now()
    emitProgress(onProgress, { type: 'started', step: 'designDocConsistency' })
    const consistency = validateDesignDocConsistency(merged)
    pushAttempt(trace, {
      phase: 'designDocConsistency',
      attempt: round,
      startedAt: tC0,
      endedAt: Date.now(),
      ok: consistency.valid,
      errors: consistency.valid
        ? undefined
        : consistency.errors.map(e => `${e.path}: ${e.message}`),
    }, options?.onAttempt)
    emitProgress(onProgress, { type: 'completed', step: 'designDocConsistency', ok: consistency.valid, detail: consistency.valid ? undefined : 'inconsistent' })

    if (consistency.valid) {
      const invChk = runVerificationInvariantSelfCheck(merged)
      if (invChk.ok) {
        designDoc = merged
        designDocReady = true
        break
      }
      if (round < MAX_CURRICULUM_VERIFICATION_ROUNDS) {
        lastVerSpecMessage = `Invariant self-check: ${invChk.message}`
        lastCombinedHint
          = `\n\n${invChk.message} Adjust verification probes and invariants. Flat-ground projectile: range uses v0^2 sin(2θ)/g; complementary angles have equal range.`
        console.warn(`[verificationInvariantSelfCheck] round ${round} — ${invChk.message}`)
        const firstErr = { path: 'verification', message: invChk.message }
        lastConsistencyErrors = [{ path: firstErr.path, message: firstErr.message }]
        emitProgress(onProgress, { type: 'failed', step: 'verificationSpec', error: invChk.message, willRetry: true })
        continue
      }
      simBuilderExtraHint
        = `Note: invariant self-check not satisfied after ${MAX_CURRICULUM_VERIFICATION_ROUNDS} round(s): ${invChk.message} — still implement, prefer runtime.physics for projectile math.`
      console.warn(`[verificationInvariantSelfCheck] ${simBuilderExtraHint}`)
      designDoc = merged
      designDocReady = true
      break
    } else {
      lastConsistencyErrors = consistency.errors
      lastCurriculumMessage = `Consistency failed (${consistency.errors.length} issue(s))`
      const summarizedErrors = consistency.errors
        .slice(0, 8)
        .map(e => `- ${e.path}: ${e.message}`)
        .join('\n')
      const paramNames = merged.params.map(p => p.name)
      const regionIds = merged.register_regions
      const metricIds = Array.from(
        new Set(merged.verification.probes.flatMap(pr => pr.expected_metrics)),
      )
      lastCombinedHint = `\nFix:\n${summarizedErrors}\nParams: ${paramNames.join(', ')}. Regions: ${regionIds.join(', ')}. Metrics: ${metricIds.join(', ')}` +
        (consistency.errors.length > 8
          ? `\n(Plus ${consistency.errors.length - 8} more.)`
          : '')

      // Feed consistency errors back to the verification-spec agent on retry.
      // Without this, lastVerSpecMessage stays '' and verHint is empty — the agent retries blind.
      const hasEmptyParams = consistency.errors.some(e => e.message.includes('Probe params must not be empty'))
      if (hasEmptyParams) {
        const paramExample = merged.params.map(p => `"${p.name}": ${p.default}`).join(', ')
        lastVerSpecMessage = `Every probe.params was empty. You MUST populate params with ALL design doc param names and concrete numeric values. Example: {${paramExample}}`
      } else {
        lastVerSpecMessage = `Consistency errors in your verification output: ${summarizedErrors}`
      }

      if (round === MAX_CURRICULUM_VERIFICATION_ROUNDS) {
        throw new GenerationFailedError({
          error: 'Design document failed consistency validation',
          phase: 'designDocConsistency',
          consistencyErrors: consistency.errors,
        })
      }
      emitProgress(onProgress, { type: 'failed', step: 'designDocConsistency', error: 'consistency', willRetry: true })
      continue
    }
  }

  if (!designDocReady || !designDoc) {
    throw new GenerationFailedError({
      error: 'Design document failed consistency validation',
      phase: 'designDocConsistency',
      consistencyErrors: lastConsistencyErrors,
    })
  }

  let simCode = ''
  let staticFailCount = 0
  let staticLoopErrors: string[] = []
  let staticAttemptSeq = 0
  let lastFailedStaticSimCode = ''

  for (let s = 0; s < MAX_STATIC_VALIDATION_ATTEMPTS; s++) {
    const tGen = Date.now()
    const staticStrategy: 'fresh' | 'repair' = s > 0 && lastFailedStaticSimCode.length > 0 ? 'repair' : 'fresh'
    emitProgress(onProgress, { type: 'started', step: 'simBuilder', subStep: 'model', attempt: s + 1 })
    const { text } = await generateText({
      model: genModel,
      system: buildSimBuilderPrompt(
        designDoc,
        staticLoopErrors,
        simBuilderExtraHint,
        staticStrategy === 'repair'
          ? { previousSimCode: lastFailedStaticSimCode, repairIntent: 'static_repair' }
          : undefined,
      ),
      prompt:
        staticStrategy === 'repair'
          ? 'Fix the previous simulation module so it passes static validation. Return the full JavaScript body.'
          : 'Generate the simulation module.',
    })
    trace.simBuilderGenerationCount++
    if (logIo) {
      logGenerationModelOutput('simBuilder', staticAttemptSeq + 1, 'sim_code', text)
    }
    emitProgress(onProgress, { type: 'completed', step: 'simBuilder', subStep: 'model', ok: true, attempt: s + 1 })
    const p2 = simBuilderSnippetForTrace(text)
    pushAttempt(trace, {
      phase: 'simBuilderAgent',
      attempt: ++staticAttemptSeq,
      startedAt: tGen,
      endedAt: Date.now(),
      ok: true,
      simBuilderModelOutput: { charCount: p2.charCount, truncated: p2.truncated, text: p2.text },
      simBuilderStrategy: staticStrategy,
    }, options?.onAttempt)

    emitProgress(onProgress, { type: 'started', step: 'simBuilder', subStep: 'static', attempt: s + 1 })
    const tS = Date.now()
    const validation = validateSimModule(text)
    console.log(
      `[simBuilder] static attempt ${staticAttemptSeq} strategy=${staticStrategy} errCount=${staticLoopErrors.length} generated ${p2.charCount} chars${p2.truncated ? ' (trace truncated)' : ''}`,
    )
    pushAttempt(trace, {
      phase: 'staticValidation',
      attempt: staticAttemptSeq,
      startedAt: tS,
      endedAt: Date.now(),
      ok: validation.valid,
      errors: validation.valid ? undefined : validation.errors,
    }, options?.onAttempt)
    emitProgress(onProgress, { type: 'completed', step: 'simBuilder', subStep: 'static', ok: validation.valid, attempt: s + 1 })

    if (validation.valid) {
      simCode = text
      console.log(`[staticValidation] attempt ${staticAttemptSeq} passed`)
      break
    }
    console.warn(
      `[staticValidation] attempt ${staticAttemptSeq} failed: ${summarizeErrors(validation.errors)}`,
    )
    lastFailedStaticSimCode = text
    staticLoopErrors = validation.errors
    staticFailCount++
  }

  trace.staticValidationRetries = staticFailCount

  if (!simCode) {
    const { designDoc: doc, simCode: code, verification } =
      await applyTemplateFallback(designDoc.domain, trace, 'static validation exhausted', options?.onAttempt, onProgress)
    console.log('[generation trace]', JSON.stringify(traceForConsoleLog(trace)))
    return {
      designDoc: doc,
      simCode: code,
      verification,
      retries: trace.simBuilderGenerationCount,
      fromTemplate: true,
      trace,
    }
  }

  const tBehave = Date.now()
  emitProgress(onProgress, { type: 'started', step: 'behavioralVerify' })
  let verification = await verifySimBehavior(simCode, designDoc)
  if (verification.passed) {
    console.log('[behavioralVerification] attempt 1 passed')
  } else {
    console.warn(
      `[behavioralVerification] attempt 1 failed: ${summarizeErrors(
        verification.checks.filter(c => !c.passed).map(c => c.message),
      )}`,
    )
  }
  pushAttempt(trace, {
    phase: 'behavioralVerification',
    attempt: 1,
    startedAt: tBehave,
    endedAt: Date.now(),
    ok: verification.passed,
    errors: verification.passed
      ? undefined
      : verification.checks.filter(c => !c.passed).map(c => c.message),
  }, options?.onAttempt)
  emitProgress(onProgress, { type: 'completed', step: 'behavioralVerify', ok: verification.passed })

  let behaviorRounds = 0
  while (!verification.passed && behaviorRounds < MAX_BEHAVIORAL_ROUNDS) {
    const invFailures = formatVerificationFailures(verification)
    console.warn(
      `[behavioralVerification] starting repair round ${behaviorRounds + 1} with ${invFailures.length} invariant failure(s)`,
    )
    let roundSim: string | null = null
    let firstInRound = true
    let inlineStatic: string[] = []
    let repairBase = simCode

    for (let s = 0; s < MAX_STATIC_VALIDATION_ATTEMPTS; s++) {
      const promptErrors = firstInRound ? invFailures : inlineStatic
      const tGen = Date.now()
      emitProgress(onProgress, { type: 'started', step: 'simBuilder', subStep: 'model', attempt: s + 1 })
      const { text } = await generateText({
        model: genModel,
        system: buildSimBuilderPrompt(designDoc, promptErrors, simBuilderExtraHint, {
          previousSimCode: repairBase,
          repairIntent: 'behavioral_repair',
        }),
        prompt: firstInRound
          ? 'Revise the simulation module so it satisfies the failed behavioral invariants. Return the full JavaScript body.'
          : 'Fix static validation on your last revision. Return the full JavaScript body.',
      })
      trace.simBuilderGenerationCount++
      if (logIo) {
        logGenerationModelOutput('simBuilder', staticAttemptSeq + 1, 'sim_code_behavioral_repair', text)
      }
      emitProgress(onProgress, { type: 'completed', step: 'simBuilder', subStep: 'model', ok: true, attempt: s + 1 })
      const validation = validateSimModule(text)
      const p2b = simBuilderSnippetForTrace(text)
      console.log(
        `[simBuilder] behavioral/static attempt ${staticAttemptSeq + 1} strategy=repair firstInv=${firstInRound} errCount=${promptErrors.length} generated ${p2b.charCount} chars${p2b.truncated ? ' (trace truncated)' : ''}`,
      )
      pushAttempt(trace, {
        phase: 'simBuilderAgent',
        attempt: ++staticAttemptSeq,
        startedAt: tGen,
        endedAt: Date.now(),
        ok: true,
        simBuilderModelOutput: { charCount: p2b.charCount, truncated: p2b.truncated, text: p2b.text },
        simBuilderStrategy: 'repair',
      }, options?.onAttempt)

      const tSt = Date.now()
      pushAttempt(trace, {
        phase: 'staticValidation',
        attempt: staticAttemptSeq,
        startedAt: tSt,
        endedAt: Date.now(),
        ok: validation.valid,
        errors: validation.valid ? undefined : validation.errors,
      }, options?.onAttempt)
      emitProgress(onProgress, { type: 'completed', step: 'simBuilder', subStep: 'static', ok: validation.valid, attempt: s + 1 })

      if (validation.valid) {
        roundSim = text
        console.log(`[staticValidation] attempt ${staticAttemptSeq} passed`)
        break
      }
      console.warn(
        `[staticValidation] attempt ${staticAttemptSeq} failed: ${summarizeErrors(validation.errors)}`,
      )
      repairBase = text
      inlineStatic = validation.errors
      firstInRound = false
    }

    if (!roundSim) {
      const { designDoc: doc, simCode: code, verification: ver } =
        await applyTemplateFallback(
          designDoc.domain,
          trace,
          'behavioral path: static validation exhausted',
          options?.onAttempt,
          onProgress,
        )
      console.log('[generation trace]', JSON.stringify(traceForConsoleLog(trace)))
      return {
        designDoc: doc,
        simCode: code,
        verification: ver,
        retries: trace.simBuilderGenerationCount,
        fromTemplate: true,
        trace,
      }
    }

    simCode = roundSim
    const tB = Date.now()
    verification = await verifySimBehavior(simCode, designDoc)
    behaviorRounds++
    trace.behavioralVerificationRetries = behaviorRounds
    const failedChecks = verification.checks.filter(c => !c.passed).map(c => c.message)
    if (verification.passed) {
      console.log(`[behavioralVerification] attempt ${behaviorRounds + 1} passed`)
    } else {
      console.warn(
        `[behavioralVerification] attempt ${behaviorRounds + 1} failed: ${summarizeErrors(failedChecks)}`,
      )
    }

    const tV = Date.now()
    pushAttempt(trace, {
      phase: 'behavioralVerification',
      attempt: behaviorRounds + 1,
      startedAt: tB,
      endedAt: tV,
      ok: verification.passed,
      errors: verification.passed
        ? undefined
        : verification.checks.filter(c => !c.passed).map(c => c.message),
    }, options?.onAttempt)
    emitProgress(onProgress, { type: 'completed', step: 'behavioralVerify', ok: verification.passed })
  }

  if (!verification.passed) {
    const { designDoc: doc, simCode: code, verification: ver } =
      await applyTemplateFallback(
        designDoc.domain,
        trace,
        'behavioral verification exhausted',
        options?.onAttempt,
        onProgress,
      )
    console.log('[generation trace]', JSON.stringify(traceForConsoleLog(trace)))
    return {
      designDoc: doc,
      simCode: code,
      verification: ver,
      retries: trace.simBuilderGenerationCount,
      fromTemplate: true,
      trace,
    }
  }

  console.log('[generation trace]', JSON.stringify(traceForConsoleLog(trace)))
  return {
    designDoc,
    simCode,
    verification,
    retries: trace.simBuilderGenerationCount,
    fromTemplate: false,
    trace,
  }
}
