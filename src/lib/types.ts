import { z } from 'zod'

import { coerceDesignDocJson } from './designDocCoercion'

// ─── Design Doc ───────────────────────────────────────────────────────────────

const SocraticStepSchema = z.object({
  id: z.string(),
  learning_goal: z.string(),
  question: z.string(),
  interaction: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('verbal_response') }),
    z.object({
      kind: z.literal('manipulate_param'),
      params: z.array(z.string()),
    }),
    z.object({
      kind: z.literal('prediction_sketch'),
      target_region: z.string().optional(),
    }),
    z.object({
      kind: z.literal('numeric_hypothesis'),
      metric: z.string(),
      unit: z.string().optional(),
    }),
    z.object({
      kind: z.literal('click_to_query'),
      regions: z.array(z.string()),
    }),
    z.object({
      kind: z.literal('observe_event'),
      event: z.string(),
    }),
  ]),
  staging: z.object({
    lock: z.array(z.string()).optional(),
    unlock: z.array(z.string()).optional(),
    highlight: z.array(z.string()).optional(),
    annotate: z.array(z.object({
      region: z.string(),
      text: z.string(),
    })).optional(),
    set_params: z.record(z.string(), z.number()).optional(),
  }),
  expected_observation: z.string().optional(),
  followup_if_correct: z.string().optional(),
  followup_if_surprised: z.string().optional(),
  exit_condition: z.string(),
})

const ProbeSchema = z.object({
  id: z.string(),
  description: z.string(),
  params: z.record(z.string(), z.number()),
  expected_metrics: z.array(z.string()),
})

const CanonicalInvariantSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('approximately_equal'),
    id: z.string(),
    description: z.string(),
    left_probe: z.string(),
    right_probe: z.string(),
    metric: z.string(),
    tolerance_percent: z.number(),
  }),
  z.object({
    kind: z.literal('monotonic'),
    id: z.string(),
    description: z.string(),
    probe_order: z.array(z.string()),
    metric: z.string(),
    direction: z.enum(['increasing', 'decreasing']),
  }),
  z.object({
    kind: z.literal('near_expected'),
    id: z.string(),
    description: z.string(),
    probe: z.string(),
    metric: z.string(),
    expected: z.number(),
    tolerance_percent: z.number(),
  }),
  z.object({
    kind: z.literal('near_maximum'),
    id: z.string(),
    description: z.string(),
    target_probe: z.string(),
    comparison_probes: z.array(z.string()),
    metric: z.string(),
    tolerance_percent: z.number(),
  }),
])

function parseTolerancePercent(value: string | number): number {
  if (typeof value === 'number') return value
  const cleaned = value.trim().replace(/%$/, '')
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : 10
}

function makeInvariantId(kind: string, ...parts: string[]): string {
  const raw = [kind, ...parts].join('_')
  return raw.replace(/[^a-zA-Z0-9_]+/g, '_').toLowerCase()
}

function parseProbeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  }
  return trimmed ? [trimmed] : []
}

function normalizeDirection(value: unknown): 'increasing' | 'decreasing' {
  if (typeof value === 'boolean') return value ? 'increasing' : 'decreasing'
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'decreasing' || normalized === 'false') return 'decreasing'
  }
  return 'increasing'
}

function normalizeInvariantInput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown>
  if (typeof record.kind === 'string') {
    return value
  }

  const type = record.type
  const typedParams = record.params
  if (typeof type === 'string' && Array.isArray(typedParams)) {
    if (type === 'approximately_equal' && typedParams.length >= 4) {
      const [left_probe, right_probe, metric, tolerance] = typedParams
      if (
        typeof left_probe === 'string'
        && typeof right_probe === 'string'
        && typeof metric === 'string'
        && (typeof tolerance === 'string' || typeof tolerance === 'number')
      ) {
        return {
          kind: 'approximately_equal' as const,
          id: makeInvariantId('approximately_equal', left_probe, right_probe, metric),
          description: `${metric} should be approximately equal for ${left_probe} and ${right_probe}.`,
          left_probe,
          right_probe,
          metric,
          tolerance_percent: parseTolerancePercent(tolerance),
        }
      }
    }

    if (type === 'near_maximum' && typedParams.length >= 4) {
      const target_probe = typedParams[0]
      const comparison_input = typedParams[1]
      const metric = typedParams[2]
      const tolerance = typedParams[3]
      if (
        typeof target_probe === 'string'
        && typeof metric === 'string'
        && (typeof tolerance === 'string' || typeof tolerance === 'number')
      ) {
        return {
          kind: 'near_maximum' as const,
          id: makeInvariantId('near_maximum', target_probe, metric),
          description: `${target_probe} should be near the maximum for ${metric}.`,
          target_probe,
          comparison_probes: parseProbeList(comparison_input),
          metric,
          tolerance_percent: parseTolerancePercent(tolerance),
        }
      }
    }

    if (type === 'monotonic' && typedParams.length >= 4) {
      const metric = typedParams[typedParams.length - 2]
      const direction = normalizeDirection(typedParams[typedParams.length - 1])
      if (typeof metric === 'string') {
        const probe_order = typedParams.slice(0, -2).map(String)
        return {
          kind: 'monotonic' as const,
          id: makeInvariantId('monotonic', metric, direction),
          description: `${metric} should change ${direction} across ${probe_order.join(' -> ')}.`,
          probe_order,
          metric,
          direction,
        }
      }
    }
  }

  const approximatelyEqual = record.approximately_equal
  if (Array.isArray(approximatelyEqual) && approximatelyEqual.length >= 4) {
    const [left_probe, right_probe, metric, tolerance] = approximatelyEqual
    if (
      typeof left_probe === 'string'
      && typeof right_probe === 'string'
      && typeof metric === 'string'
      && (typeof tolerance === 'string' || typeof tolerance === 'number')
    ) {
      return {
        kind: 'approximately_equal' as const,
        id: makeInvariantId('approximately_equal', left_probe, right_probe, metric),
        description: `${metric} should be approximately equal for ${left_probe} and ${right_probe}.`,
        left_probe,
        right_probe,
        metric,
        tolerance_percent: parseTolerancePercent(tolerance),
      }
    }
  }

  const nearMaximum = record.near_maximum
  if (Array.isArray(nearMaximum) && nearMaximum.length >= 4) {
    const target_probe = nearMaximum[0]
    const comparison_input = nearMaximum.length > 4 ? nearMaximum.slice(1, -2) : nearMaximum[1]
    const metric = nearMaximum[nearMaximum.length - 2]
    const tolerance = nearMaximum[nearMaximum.length - 1]
    if (
      typeof target_probe === 'string'
      && typeof metric === 'string'
      && (typeof tolerance === 'string' || typeof tolerance === 'number')
    ) {
      return {
        kind: 'near_maximum' as const,
        id: makeInvariantId('near_maximum', target_probe, metric),
        description: `${target_probe} should be near the maximum for ${metric}.`,
        target_probe,
        comparison_probes: parseProbeList(comparison_input),
        metric,
        tolerance_percent: parseTolerancePercent(tolerance),
      }
    }
  }

  const monotonic = record.monotonic
  if (Array.isArray(monotonic) && monotonic.length >= 4) {
    const metric = monotonic[monotonic.length - 2]
    const rawDirection = monotonic[monotonic.length - 1]
    if (typeof metric === 'string') {
      const direction = normalizeDirection(rawDirection)
      const probe_order = monotonic.slice(0, -2).map(String)
      return {
        kind: 'monotonic' as const,
        id: makeInvariantId('monotonic', metric, direction),
        description: `${metric} should change ${direction} across ${probe_order.join(' -> ')}.`,
        probe_order,
        metric,
        direction,
      }
    }
  }

  const nearExpected = record.near_expected
  if (Array.isArray(nearExpected) && nearExpected.length >= 4) {
    const [probe, metric, expectedRaw, tolerance] = nearExpected
    const expected
      = typeof expectedRaw === 'number'
        ? expectedRaw
        : typeof expectedRaw === 'string'
          ? Number.parseFloat(expectedRaw.trim())
          : Number.NaN
    if (
      typeof probe === 'string'
      && typeof metric === 'string'
      && Number.isFinite(expected)
      && (typeof tolerance === 'string' || typeof tolerance === 'number')
    ) {
      return {
        kind: 'near_expected' as const,
        id: makeInvariantId('near_expected', probe, metric),
        description: `${metric} should be near ${expected} for ${probe}.`,
        probe,
        metric,
        expected,
        tolerance_percent: parseTolerancePercent(tolerance),
      }
    }
  }

  return value
}

const InvariantSchema = z.preprocess(
  normalizeInvariantInput,
  CanonicalInvariantSchema,
)

const DesignDocCoreSchema = z.object({
  concept: z.string(),
  domain: z.enum(['physics', 'math', 'biology', 'chemistry', 'general']),
  renderer: z.enum(['p5', 'canvas2d', 'jsxgraph', 'matter']),
  episodic: z.boolean(),
  params: z.array(z.object({
    name: z.string(),
    range: z.array(z.number()).length(2),
    default: z.number(),
    label: z.string(),
    unit: z.string().optional(),
    pedagogical_note: z.string().optional(),
  })),
  governing_equations: z.array(z.string()),
  emit_events: z.array(z.string()),
  register_regions: z.array(z.string()),
  initial_staging: z.object({
    locked: z.array(z.string()),
    highlighted: z.array(z.string()),
  }),
  socratic_plan: z.array(SocraticStepSchema).min(2).max(6),
  verification: z.object({
    summary: z.string(),
    probes: z.array(ProbeSchema).min(2).max(8),
    invariants: z.array(InvariantSchema).min(2).max(8),
  }),
})

export const DesignDocSchema = z.preprocess(coerceDesignDocJson, DesignDocCoreSchema)

export type DesignDoc = z.infer<typeof DesignDocSchema>
export type SocraticStep = z.infer<typeof SocraticStepSchema>
export type Probe = z.infer<typeof ProbeSchema>
export type Invariant = z.infer<typeof InvariantSchema>

// ─── Verification ─────────────────────────────────────────────────────────────

export type ProbeResult = {
  probeId: string
  params: Record<string, number>
  metrics: Record<string, number>
  events: Array<{ event: string; payload: Record<string, unknown>; timestamp: number }>
}

export type VerificationCheckResult = {
  invariantId: string
  passed: boolean
  message: string
  observed?: Record<string, number>
}

export type VerificationReport = {
  passed: boolean
  checks: VerificationCheckResult[]
  probeResults: ProbeResult[]
}

// ─── Simulation Manifest (from iframe MANIFEST message) ───────────────────────

export type ParamDef = {
  name: string
  min: number
  max: number
  default: number
  label: string
  unit?: string
}

export type Manifest = {
  params: ParamDef[]
  regions: string[]
  events: string[]
  animates: boolean
  episodic: boolean
}

// ─── postMessage Protocol ─────────────────────────────────────────────────────

export type AgentCmd =
  | { type: 'LOAD_SIM';  code: string }
  | { type: 'TRACK_REGIONS'; enabled: boolean }
  | { type: 'AGENT_CMD'; action: 'set_param';       target: string; value: number }
  | { type: 'AGENT_CMD'; action: 'lock';             target: string }
  | { type: 'AGENT_CMD'; action: 'unlock';           target: string }
  | { type: 'AGENT_CMD'; action: 'highlight';        target: string }
  | { type: 'AGENT_CMD'; action: 'annotate';         region: string; text: string }
  | { type: 'AGENT_CMD'; action: 'clear_annotations' }
  | { type: 'AGENT_CMD'; action: 'checkpoint' }
  | { type: 'AGENT_CMD'; action: 'restore';          id: string }
  | { type: 'AGENT_CMD'; action: 'trigger_event';    eventType: string }
  | { type: 'AGENT_CMD'; action: 'set_scene';        config: Record<string, number> }
  | { type: 'AGENT_CMD'; action: 'pause' }
  | { type: 'AGENT_CMD'; action: 'play' }
  | { type: 'AGENT_CMD'; action: 'launch' }
  | { type: 'AGENT_CMD'; action: 'reset' }

export type IframeMessage =
  | { type: 'MANIFEST';         params: ParamDef[]; regions: string[]; events: string[]; animates: boolean; episodic: boolean }
  | { type: 'PARAM_CHANGED';    param: string; from: number; to: number; sim_state: Record<string, number> }
  | { type: 'SIM_EVENT';        event: string; payload: Record<string, unknown>; timestamp: number }
  | { type: 'REGION_POSITIONS'; regions: Record<string, { x: number; y: number } | null> }
  | { type: 'ANNOTATIONS';      annotations: Record<string, string> }
  | { type: 'CHECKPOINT_SAVED'; id: string }
  | { type: 'SIM_PAUSED' }
  | { type: 'SIM_RESUMED' }
  | { type: 'SIM_PHASE';        phase: 'idle' | 'active' | 'done' }
  | { type: 'SIM_ERROR';        error: string }

// ─── API Contracts ────────────────────────────────────────────────────────────

export type GenerateRequest = {
  concept: string
}

export type GenerateResponse = {
  designDoc: DesignDoc
  simCode: string
  verification: VerificationReport
  retries: number
  fromTemplate: boolean
}

/** Pass 1 failure diagnostics (local JSON extract + Zod). */
export type Pass1ZodIssue = { path: string; message: string }

export type Pass1Diagnosis = {
  parseError?: string
  zodIssues: Pass1ZodIssue[]
  /** Set when JSON + schema succeed here but AI SDK still failed (rare). */
  localSchemaOk?: boolean
  /** Raw model text prefix when debug on (see `pass1Debug` / API route). */
  textPreview?: string
}

export type GenerateErrorResponse = {
  error: string
  phase: 'pass1' | 'pass2' | 'validation' | 'verification' | 'designDocConsistency' | 'fallback' | 'template'
  /** When `phase === 'designDocConsistency'` */
  consistencyErrors?: Array<{ path: string; message: string }>
  generatedText?: string
  validationErrors?: string[]
  verification?: VerificationReport
  /** When `phase === 'pass1'` and debug enabled — see `POST /api/generate` + `PRAXIO_DEBUG_GENERATION`. */
  pass1Diagnosis?: Pass1Diagnosis
}

export type SimEvent = {
  event: string
  param?: string
  from?: number
  to?: number
  sim_state?: Record<string, number>
  payload?: Record<string, unknown>
  timestamp: number
}

export type TutorMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type StageRequest = {
  messages: TutorMessage[]
  pendingEvents: SimEvent[]
  manifest: Manifest
  designDoc: DesignDoc
  sessionId: string
  activeSocraticStepId?: string
}

export type StageResponse = {
  toolCalls: Array<{
    toolName: string
    input: Record<string, unknown>
  }>
}

export type AppliedToolCall = {
  toolName: string
  input: Record<string, unknown>
  result: { id: string } | null
}

export type SpeakRequest = StageRequest & {
  appliedToolCalls: AppliedToolCall[]
}

// ─── MongoDB Schemas ──────────────────────────────────────────────────────────

export type Workspace = {
  sessionId: string
  concept: string
  domain: string
  renderer: 'p5' | 'canvas2d' | 'jsxgraph' | 'matter'
  designDoc: DesignDoc
  createdAt: Date
}

export type Checkpoint = {
  id: string
  paramValues: Record<string, number>
  internalState: unknown
  savedAt: Date
}

export type Branch = {
  workspaceId: string
  sessionId: string
  name: string
  checkpoints: Checkpoint[]
  conversationHistory: TutorMessage[]
  createdAt: Date
}

export type DbSimEvent = {
  branchId: string
  event: string
  param?: string
  from?: number
  to?: number
  sim_state?: Record<string, number>
  payload?: Record<string, unknown>
  timestamp: number
}
