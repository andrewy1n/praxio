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

// Raw probe as the model emits it: params is an array so JSON schema enforces minItems:1.
// normalizeVerificationBlock converts this to ProbeSchema (record) before pipeline use.
const ProbeRawSchema = z.object({
  id: z.string(),
  description: z.string(),
  params: z.array(z.object({ name: z.string(), value: z.number() })).min(1).max(20),
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

/** Behavioral verification block (emitted by verification-spec agent, merged into DesignDoc). */
export const VerificationBlockSchema = z.object({
  summary: z.string(),
  probes: z.array(ProbeSchema).min(2).max(8),
  invariants: z.array(InvariantSchema).min(2).max(8),
})
export type VerificationBlock = z.infer<typeof VerificationBlockSchema>

/** Raw verification block as the model outputs it — probe params is an array (minItems:1 in JSON schema). */
export const VerificationBlockRawSchema = z.object({
  summary: z.string(),
  probes: z.array(ProbeRawSchema).min(2).max(8),
  invariants: z.array(InvariantSchema).min(2).max(8),
})
export type VerificationBlockRaw = z.infer<typeof VerificationBlockRawSchema>

const DesignDocBaseFieldsSchema = z.object({
  concept: z.string(),
  domain: z.enum(['physics', 'math', 'biology', 'chemistry', 'general']),
  /** Optional: which runtime primitive pack to use (e.g. physics.projectile, math.derivative_line). */
  primitive: z.string().optional(),
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
})

/** Design doc from curriculum agent only (no verification block). */
export const DesignDocCoreSchema = z.preprocess(
  coerceDesignDocJson,
  DesignDocBaseFieldsSchema,
)
export type DesignDocCore = z.infer<typeof DesignDocCoreSchema>

const DesignDocWithVerificationSchema = DesignDocBaseFieldsSchema.extend({
  verification: VerificationBlockSchema,
})

export const DesignDocSchema = z.preprocess(coerceDesignDocJson, DesignDocWithVerificationSchema)

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
  /** Anonymous session id from localStorage; required for DB-backed workspaces. */
  sessionId: string
}

export type GenerateResponse = {
  designDoc: DesignDoc
  simCode: string
  verification: VerificationReport
  retries: number
  fromTemplate: boolean
  /** Set when workspace was persisted to MongoDB. */
  workspaceId?: string
}

/** Curriculum-agent failure diagnostics (local JSON extract + Zod). */
export type CurriculumAgentZodIssue = { path: string; message: string }

export type CurriculumAgentDiagnosis = {
  parseError?: string
  zodIssues: CurriculumAgentZodIssue[]
  /** Set when JSON + schema succeed here but AI SDK still failed (rare). */
  localSchemaOk?: boolean
  /** Raw model text prefix when debug on. */
  textPreview?: string
}

export type GenerateErrorPhase =
  | 'curriculumAgent'
  | 'verificationSpecAgent'
  | 'simBuilderAgent'
  | 'requestValidation'
  | 'designDocConsistency'
  | 'validation'
  | 'behavioralVerification'
  | 'fallback'
  | 'template'

export type GenerateErrorResponse = {
  error: string
  phase: GenerateErrorPhase
  /** When `phase === 'designDocConsistency'` */
  consistencyErrors?: Array<{ path: string; message: string }>
  generatedText?: string
  validationErrors?: string[]
  verification?: VerificationReport
  /** When `phase === 'curriculumAgent'` and debug enabled. */
  curriculumAgentDiagnosis?: CurriculumAgentDiagnosis
  /** When `phase === 'verificationSpecAgent'` and debug enabled. */
  verificationSpecAgentDiagnosis?: CurriculumAgentDiagnosis
}

/** UI + stream progress: high-level generation steps. */
export type GenerateProgressStepId =
  | 'curriculum'
  | 'verificationSpec'
  | 'designDocConsistency'
  | 'simBuilder'
  | 'behavioralVerify'
  | 'fallback'

/**
 * NDJSON events from `POST /api/generate?stream=1` (and shared contract for clients).
 * `attempt` mirrors internal pipeline `GenerationAttemptTrace` for power users / trace.
 */
export type GenerateStreamEvent =
  | { type: 'started' }
  | {
    type: 'progress_step_started'
    step: GenerateProgressStepId
    /** Sub-step within sim-builder: model generation vs static check */
    subStep?: 'model' | 'static'
    attempt?: number
  }
  | {
    type: 'progress_step_completed'
    step: GenerateProgressStepId
    ok: boolean
    subStep?: 'model' | 'static'
    attempt?: number
    detail?: string
  }
  | {
    type: 'progress_step_failed'
    step: GenerateProgressStepId
    error: string
    willRetry: boolean
  }
  | { type: 'attempt'; attempt: Record<string, unknown> }
  | { type: 'result'; result: GenerateResponse & { trace?: unknown } }
  | { type: 'error'; status: number; error: GenerateErrorResponse }

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
  /** When omitted or `dev`, tutor routes skip MongoDB (e.g. test harness). */
  workspaceId?: string
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

// ─── Workspace API (planning/api_contracts.md) ───────────────────────────────

export type WorkspaceStatus = 'in_progress' | 'completed'

export type ListWorkspacesQuery = {
  sessionId: string
  limit?: number
}

export type WorkspaceListItem = {
  workspaceId: string
  concept: string
  domain: DesignDoc['domain']
  renderer: DesignDoc['renderer']
  status: WorkspaceStatus
  createdAt: string
  lastActiveAt: string
  completedAt?: string
  completionSummary?: string
}

export type ListWorkspacesResponse = {
  items: WorkspaceListItem[]
}

export type GetWorkspaceParams = {
  workspaceId: string
}

export type SessionCompletionState = {
  isComplete: boolean
  completedStepIds: string[]
  completedAt?: number
  summary?: {
    synthesis: string
    transferQuestion: string
  }
}

export type GetWorkspaceResponse = {
  workspace: {
    workspaceId: string
    sessionId: string
    concept: string
    domain: DesignDoc['domain']
    renderer: DesignDoc['renderer']
    designDoc: DesignDoc
    status: WorkspaceStatus
    createdAt: string
    lastActiveAt: string
    completedAt?: string
    simCode: string
  }
  branch?: {
    branchId: string
    name: string
    checkpoints: Checkpoint[]
    conversationHistory: TutorMessage[]
    currentSocraticStepId?: string
  }
  completion?: SessionCompletionState
}

export type UpdateWorkspaceRequest = {
  sessionId: string
  status?: WorkspaceStatus
  lastActiveAt?: string
  completedAt?: string
  completionSummary?: string
  /** Replaces completed step ids when provided (merge on server). */
  completedStepIds?: string[]
}

export type UpdateWorkspaceResponse = {
  ok: true
}

export type SessionLearningArtifact = {
  sessionId: string
  workspaceId: string
  completedStepIds: string[]
  keyMoments: Array<{
    stepId: string
    interactionKind: DesignDoc['socratic_plan'][number]['interaction']['kind']
    observedEvent: string
    timestamp: number
  }>
  finalSynthesis: string
  transferQuestion: string
  transferResponse?: string
  createdAt: Date
}

// ─── MongoDB Schemas ──────────────────────────────────────────────────────────

export type Workspace = {
  workspaceId: string
  sessionId: string
  concept: string
  domain: DesignDoc['domain']
  renderer: DesignDoc['renderer']
  designDoc: DesignDoc
  simCode: string
  status: WorkspaceStatus
  createdAt: Date
  lastActiveAt: Date
  completedAt?: Date
  completionSummary?: string
  completedStepIds: string[]
  completion?: SessionCompletionState
  /** Persisted synthesis / transfer for resume; optional until session completes. */
  learningArtifact?: SessionLearningArtifact
}

export type Checkpoint = {
  id: string
  paramValues: Record<string, number>
  internalState: unknown
  savedAt: Date
}

export type Branch = {
  branchId: string
  workspaceId: string
  sessionId: string
  name: string
  checkpoints: Checkpoint[]
  conversationHistory: TutorMessage[]
  /** Tracks UI-selected step for completion transitions. */
  currentSocraticStepId?: string
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
