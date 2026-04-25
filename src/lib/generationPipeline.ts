import { generateText, NoObjectGeneratedError, Output } from 'ai'
import { google } from '@ai-sdk/google'

import { buildPass2Prompt, PASS1_SYSTEM_PROMPT } from '@/lib/prompts'
import {
  DesignDocSchema,
  type DesignDoc,
  type GenerateErrorResponse,
  type GenerateResponse,
  type Pass1Diagnosis,
  type VerificationReport,
} from '@/lib/types'
import { diagnosePass1ModelText } from '@/lib/pass1Debug'
import { validateDesignDocConsistency } from '@/lib/designDocConsistency'
import { validateSimModule } from '@/lib/validation'
import { formatVerificationFailures, verifySimBehavior } from '@/lib/verification'
import { loadTemplateByDomain } from '@/lib/templateRegistry'

const genModel = google('gemini-2.5-flash')

const MAX_PASS1_ATTEMPTS = 3
const MAX_STATIC_VALIDATION_ATTEMPTS = 3
const MAX_BEHAVIORAL_ROUNDS = 3

/** Max chars of Pass 2 sim code stored per trace step (full text if shorter) */
const PASS2_TEXT_TRACE_MAX = 14_000

function pass2SnippetForTrace(text: string): {
  charCount: number
  truncated: boolean
  text: string
} {
  const charCount = text.length
  if (charCount <= PASS2_TEXT_TRACE_MAX) {
    return { charCount, truncated: false, text }
  }
  return {
    charCount,
    truncated: true,
    text: text.slice(0, PASS2_TEXT_TRACE_MAX),
  }
}

/** Server log: omit Pass 2 text (can be 10k+ chars per attempt) */
function traceForConsoleLog(t: GenerationTrace): Record<string, unknown> {
  return {
    ...t,
    attempts: t.attempts.map((a) => {
      if (!a.pass2ModelOutput) return a
      return {
        ...a,
        pass2ModelOutput: {
          charCount: a.pass2ModelOutput.charCount,
          truncated: a.pass2ModelOutput.truncated,
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
  | 'pass1'
  | 'designDocConsistency'
  | 'pass2'
  | 'staticValidation'
  | 'behavioralVerification'
  | 'fallback'

export type GenerationAttemptTrace = {
  phase: GenerationAttemptPhase
  attempt: number
  startedAt: number
  endedAt: number
  ok: boolean
  errors?: string[]
  /**
   * Raw Pass 2 model output (sim code string) for this attempt.
   * Present on `staticValidation` steps after each `generateText` for Pass 2.
   */
  pass2ModelOutput?: {
    charCount: number
    truncated: boolean
    text: string
  }
}

export type GenerationTrace = {
  concept: string
  selectedRenderer?: DesignDoc['renderer']
  /**
   * Pass 1 is structured output (`Output.object`); the parsed doc is the API `designDoc`
   * field — not duplicated here. Pass 2 sim code appears on each `staticValidation`
   * attempt as `pass2ModelOutput` and in full as `simCode` on success.
   */
  attempts: GenerationAttemptTrace[]
  /** Count of failed static validations in the initial Pass 2 loop (before first behavioral check) */
  staticValidationRetries: number
  /** Number of behavioral rounds that did not pass after re-generation (0 if first verify passed) */
  behavioralVerificationRetries: number
  /** Total `generateText` calls for Pass 2 (initial + behavioral path) */
  pass2GenerationCount: number
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

async function applyTemplateFallback(
  domain: DesignDoc['domain'],
  trace: GenerationTrace,
  reason: string,
  onAttempt?: (attempt: GenerationAttemptTrace, trace: GenerationTrace) => void,
): Promise<{
  designDoc: DesignDoc
  simCode: string
  verification: VerificationReport
}> {
  const loaded = await loadTemplateByDomain(domain)
  if (!loaded) {
    throw new GenerationFailedError({
      error: `No template available for domain "${domain}" (${reason})`,
      phase: 'template',
    })
  }

  const consistency = validateDesignDocConsistency(loaded.designDoc)
  if (!consistency.valid) {
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
    throw new GenerationFailedError({
      error: 'Template sim failed behavioral verification',
      phase: 'template',
      verification,
    })
  }

  trace.fromTemplate = true
  trace.templateId = loaded.id
  return {
    designDoc: loaded.designDoc,
    simCode: loaded.simCode,
    verification,
  }
}

export type RunGenerationPipelineOptions = {
  /** When true, failed pass1 includes `pass1Diagnosis` on `GenerationFailedError.body`. */
  debug?: boolean
  /** Optional callback for real-time backend phase updates. */
  onAttempt?: (attempt: GenerationAttemptTrace, trace: GenerationTrace) => void
}

export async function runGenerationPipeline(
  concept: string,
  options?: RunGenerationPipelineOptions,
): Promise<GenerationPipelineSuccess> {
  const trace: GenerationTrace = {
    concept,
    attempts: [],
    staticValidationRetries: 0,
    behavioralVerificationRetries: 0,
    pass2GenerationCount: 0,
    fromTemplate: false,
  }

  let designDoc!: DesignDoc
  let lastPass1Message = ''
  let lastPass1Diagnosis: Pass1Diagnosis = { zodIssues: [] }
  let lastConsistencyErrors: Array<{ path: string; message: string }> = []
  let lastConsistencyHint = ''
  let designDocReady = false

  for (let pass1Attempt = 1; pass1Attempt <= MAX_PASS1_ATTEMPTS; pass1Attempt++) {
    const t1 = Date.now()
    const retryHint =
      pass1Attempt > 1
        ? `\n\nYour previous structured output failed validation: ${lastPass1Message}${lastConsistencyHint}\nRegenerate the full design document. Rules: each socratic_plan step "interaction" must be an object with "kind" (never a bare string). Each param must have "range": [min, max] as two numbers. Use lowercase domain and renderer enum values exactly: physics|math|biology|chemistry|general and p5|canvas2d|jsxgraph|matter.`
        : ''

    try {
      const pass1 = await generateText({
        model: genModel,
        output: Output.object({ schema: DesignDocSchema }),
        system: PASS1_SYSTEM_PROMPT,
        prompt: `${concept}${retryHint}`,
      })
      designDoc = pass1.output
      trace.selectedRenderer = designDoc.renderer
      pushAttempt(trace, {
        phase: 'pass1',
        attempt: pass1Attempt,
        startedAt: t1,
        endedAt: Date.now(),
        ok: true,
      }, options?.onAttempt)

      const tC0 = Date.now()
      const consistency = validateDesignDocConsistency(designDoc)
      pushAttempt(trace, {
        phase: 'designDocConsistency',
        attempt: pass1Attempt,
        startedAt: tC0,
        endedAt: Date.now(),
        ok: consistency.valid,
        errors: consistency.valid
          ? undefined
          : consistency.errors.map(e => `${e.path}: ${e.message}`),
      }, options?.onAttempt)

      if (consistency.valid) {
        designDocReady = true
        break
      }

      lastConsistencyErrors = consistency.errors
      lastPass1Message = `Consistency failed (${consistency.errors.length} issue(s))`
      const summarizedErrors = consistency.errors
        .slice(0, 8)
        .map(e => `- ${e.path}: ${e.message}`)
        .join('\n')
      const paramNames = designDoc.params.map(p => p.name)
      const regionIds = designDoc.register_regions
      const metricIds = Array.from(
        new Set(designDoc.verification.probes.flatMap(pr => pr.expected_metrics)),
      )
      lastConsistencyHint = `\nFix all of these consistency issues exactly:\n${summarizedErrors}\nAllowed IDs for this retry:\n- params[].name: ${paramNames.join(', ') || '(none)'}\n- register_regions: ${regionIds.join(', ') || '(none)'}\n- verification.probes[].expected_metrics: ${metricIds.join(', ') || '(none)'}` +
        (consistency.errors.length > 8
          ? `\n(Plus ${consistency.errors.length - 8} additional issue(s) not shown.)`
          : '')
      const firstErr = consistency.errors[0]
      console.warn(
        `[designDocConsistency] attempt ${pass1Attempt} — ${firstErr ? `${firstErr.path}: ${firstErr.message}` : 'Consistency failed'}`,
      )

      if (pass1Attempt === MAX_PASS1_ATTEMPTS) {
        throw new GenerationFailedError({
          error: 'Design document failed consistency validation',
          phase: 'designDocConsistency',
          consistencyErrors: consistency.errors,
        })
      }
      continue
    } catch (e) {
      if (e instanceof GenerationFailedError) throw e
      lastPass1Message = e instanceof Error ? e.message : 'Pass 1 failed'
      if (NoObjectGeneratedError.isInstance(e) && e.text?.length) {
        lastPass1Message = `${lastPass1Message} (model text ${e.text.length} chars, finish: ${String(e.finishReason)})`
      }

      const baseDiag = NoObjectGeneratedError.isInstance(e)
        ? diagnosePass1ModelText(e.text)
        : { zodIssues: [] as Pass1Diagnosis['zodIssues'] }
      lastPass1Diagnosis
        = options?.debug && NoObjectGeneratedError.isInstance(e) && e.text
          ? { ...baseDiag, textPreview: e.text.slice(0, 1500) }
          : baseDiag

      const hint
        = lastPass1Diagnosis.parseError
          ?? (lastPass1Diagnosis.zodIssues[0]
            && `${lastPass1Diagnosis.zodIssues[0].path}: ${lastPass1Diagnosis.zodIssues[0].message}`)
          ?? (lastPass1Diagnosis.localSchemaOk ? 'local Zod OK — provider/SDK mismatch' : null)
      if (hint) console.warn(`[pass1] attempt ${pass1Attempt} — ${hint}`)

      pushAttempt(trace, {
        phase: 'pass1',
        attempt: pass1Attempt,
        startedAt: t1,
        endedAt: Date.now(),
        ok: false,
        errors: [lastPass1Message],
      }, options?.onAttempt)
      if (pass1Attempt === MAX_PASS1_ATTEMPTS) {
        throw new GenerationFailedError({
          error: lastPass1Message,
          phase: 'pass1',
          ...(options?.debug
            ? { pass1Diagnosis: lastPass1Diagnosis }
            : {}),
        })
      }
    }
  }

  if (!designDocReady) {
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

  for (let s = 0; s < MAX_STATIC_VALIDATION_ATTEMPTS; s++) {
    const tP = Date.now()
    const { text } = await generateText({
      model: genModel,
      system: buildPass2Prompt(designDoc, staticLoopErrors),
      prompt: 'Generate the simulation module.',
    })
    trace.pass2GenerationCount++
    const validation = validateSimModule(text)
    const p2 = pass2SnippetForTrace(text)
    console.log(
      `[pass2] static attempt ${staticAttemptSeq + 1} generated ${p2.charCount} chars${p2.truncated ? ' (trace truncated)' : ''}`,
    )
    pushAttempt(trace, {
      phase: 'staticValidation',
      attempt: ++staticAttemptSeq,
      startedAt: tP,
      endedAt: Date.now(),
      ok: validation.valid,
      errors: validation.valid ? undefined : validation.errors,
      pass2ModelOutput: {
        charCount: p2.charCount,
        truncated: p2.truncated,
        text: p2.text,
      },
    }, options?.onAttempt)

    if (validation.valid) {
      simCode = text
      console.log(`[staticValidation] attempt ${staticAttemptSeq} passed`)
      break
    }
    console.warn(
      `[staticValidation] attempt ${staticAttemptSeq} failed: ${summarizeErrors(validation.errors)}`,
    )
    staticLoopErrors = validation.errors
    staticFailCount++
  }

  trace.staticValidationRetries = staticFailCount

  if (!simCode) {
    const { designDoc: doc, simCode: code, verification } =
      await applyTemplateFallback(designDoc.domain, trace, 'static validation exhausted', options?.onAttempt)
    console.log('[generation trace]', JSON.stringify(traceForConsoleLog(trace)))
    return {
      designDoc: doc,
      simCode: code,
      verification,
      retries: trace.pass2GenerationCount,
      fromTemplate: true,
      trace,
    }
  }

  const tV0 = Date.now()
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
    startedAt: tV0,
    endedAt: Date.now(),
    ok: verification.passed,
    errors: verification.passed
      ? undefined
      : verification.checks.filter(c => !c.passed).map(c => c.message),
  }, options?.onAttempt)

  let behaviorRounds = 0
  while (!verification.passed && behaviorRounds < MAX_BEHAVIORAL_ROUNDS) {
    const invFailures = formatVerificationFailures(verification)
    console.warn(
      `[behavioralVerification] starting repair round ${behaviorRounds + 1} with ${invFailures.length} invariant failure(s)`,
    )
    let roundSim: string | null = null
    let firstInRound = true
    let inlineStatic: string[] = []

    for (let s = 0; s < MAX_STATIC_VALIDATION_ATTEMPTS; s++) {
      const promptErrors = firstInRound ? invFailures : inlineStatic
      const tP = Date.now()
      const { text } = await generateText({
        model: genModel,
        system: buildPass2Prompt(designDoc, promptErrors),
        prompt:
          'Regenerate the simulation module so it satisfies the failed behavioral invariants.',
      })
      trace.pass2GenerationCount++
      const validation = validateSimModule(text)
      const p2b = pass2SnippetForTrace(text)
      console.log(
        `[pass2] behavioral/static attempt ${staticAttemptSeq + 1} generated ${p2b.charCount} chars${p2b.truncated ? ' (trace truncated)' : ''}`,
      )
      pushAttempt(trace, {
        phase: 'staticValidation',
        attempt: ++staticAttemptSeq,
        startedAt: tP,
        endedAt: Date.now(),
        ok: validation.valid,
        errors: validation.valid ? undefined : validation.errors,
        pass2ModelOutput: {
          charCount: p2b.charCount,
          truncated: p2b.truncated,
          text: p2b.text,
        },
      }, options?.onAttempt)

      if (validation.valid) {
        roundSim = text
        console.log(`[staticValidation] attempt ${staticAttemptSeq} passed`)
        break
      }
      console.warn(
        `[staticValidation] attempt ${staticAttemptSeq} failed: ${summarizeErrors(validation.errors)}`,
      )
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
        )
      console.log('[generation trace]', JSON.stringify(traceForConsoleLog(trace)))
      return {
        designDoc: doc,
        simCode: code,
        verification: ver,
        retries: trace.pass2GenerationCount,
        fromTemplate: true,
        trace,
      }
    }

    simCode = roundSim
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
      startedAt: tV,
      endedAt: Date.now(),
      ok: verification.passed,
      errors: verification.passed
        ? undefined
        : verification.checks.filter(c => !c.passed).map(c => c.message),
    }, options?.onAttempt)
  }

  if (!verification.passed) {
    const { designDoc: doc, simCode: code, verification: ver } =
      await applyTemplateFallback(
        designDoc.domain,
        trace,
        'behavioral verification exhausted',
        options?.onAttempt,
      )
    console.log('[generation trace]', JSON.stringify(traceForConsoleLog(trace)))
    return {
      designDoc: doc,
      simCode: code,
      verification: ver,
      retries: trace.pass2GenerationCount,
      fromTemplate: true,
      trace,
    }
  }

  console.log('[generation trace]', JSON.stringify(traceForConsoleLog(trace)))
  return {
    designDoc,
    simCode,
    verification,
    retries: trace.pass2GenerationCount,
    fromTemplate: false,
    trace,
  }
}
