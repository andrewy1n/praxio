# API Contracts
### Praxio — LA Hacks 2026

---

## Next.js API Routes

### `POST /api/generate`

Runs the two-pass simulation generation pipeline server-side. Keeps the Google AI Studio key out of the client.

**Request**
```typescript
type GenerateRequest = {
  concept: string   // raw student input, e.g. "projectile motion"
}
```

**Response**
```typescript
type GenerateResponse = {
  designDoc: DesignDoc
  simCode: string
  verification: VerificationReport
  retries: number        // how many Pass 2 retries were needed (0–3)
  fromTemplate: boolean  // true if 3-strike fallback was used
}

type GenerateErrorResponse = {
  error: string
  phase: 'pass1' | 'pass2' | 'validation'
}
```

### `GET /api/workspaces`

Lists recent workspaces for the current anonymous session.

**Request**
```typescript
type ListWorkspacesQuery = {
  sessionId: string
  limit?: number // default 20, max 50
}
```

**Response**
```typescript
type WorkspaceListItem = {
  workspaceId: string
  concept: string
  domain: DesignDoc['domain']
  renderer: DesignDoc['renderer']
  status: 'in_progress' | 'completed'
  createdAt: string
  lastActiveAt: string
  completedAt?: string
  completionSummary?: string
}

type ListWorkspacesResponse = {
  items: WorkspaceListItem[]
}
```

**Behavior**

- Returns workspaces for `sessionId` only.
- Sorted by `lastActiveAt` descending.
- Designed for Landing `Recent workspaces` panel and Workspace switchers.

### `GET /api/workspaces/:workspaceId`

Fetches one workspace for resume/re-entry.

**Request**
```typescript
type GetWorkspaceParams = {
  workspaceId: string
}
```

**Response**
```typescript
type GetWorkspaceResponse = {
  workspace: {
    workspaceId: string
    sessionId: string
    concept: string
    domain: DesignDoc['domain']
    renderer: DesignDoc['renderer']
    designDoc: DesignDoc
    status: 'in_progress' | 'completed'
    createdAt: string
    lastActiveAt: string
    completedAt?: string
  }
  branch?: {
    branchId: string
    name: string
    checkpoints: Checkpoint[]
    conversationHistory: TutorMessage[]
  }
  completion?: SessionCompletionState
}
```

**Behavior**

- Rejects cross-session access (`workspace.sessionId` must match requester `sessionId`).
- If `status === 'completed'`, `completion` should be returned so UI can open in
  post-session completion mode (synthesis + transfer question + completion actions)
  instead of restarting step progression.

### `PATCH /api/workspaces/:workspaceId`

Updates session progress metadata used by recent-workspace/resume UI.

**Request**
```typescript
type UpdateWorkspaceRequest = {
  sessionId: string
  status?: 'in_progress' | 'completed'
  lastActiveAt?: string
  completedAt?: string
  completionSummary?: string
}
```

**Response**
```typescript
type UpdateWorkspaceResponse = {
  ok: true
}
```

**Pass 1 — generateObject schema (Zod)**
```typescript
import { z } from 'zod'

const DesignDocSchema = z.object({
  concept: z.string(),
  domain: z.enum(['physics', 'math', 'biology', 'chemistry', 'general']),
  renderer: z.enum(['p5', 'canvas2d', 'jsxgraph', 'matter']),
  episodic: z.boolean(),  // true → sim has a discrete run/reset cycle; false → runs continuously on load
  params: z.array(z.object({
    name: z.string(),
    range: z.tuple([z.number(), z.number()]),
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
  socratic_plan: z.array(z.object({
    id: z.string(),
    learning_goal: z.string(),
    question: z.string(),
    interaction: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('verbal_response') }),
      z.object({ kind: z.literal('manipulate_param'), params: z.array(z.string()) }),
      z.object({ kind: z.literal('prediction_sketch'), target_region: z.string().optional() }),
      z.object({ kind: z.literal('numeric_hypothesis'), metric: z.string(), unit: z.string().optional() }),
      z.object({ kind: z.literal('click_to_query'), regions: z.array(z.string()) }),
      z.object({ kind: z.literal('observe_event'), event: z.string() }),
    ]),
    staging: z.object({
      lock: z.array(z.string()).optional(),
      unlock: z.array(z.string()).optional(),
      highlight: z.array(z.string()).optional(),
      annotate: z.array(z.object({ region: z.string(), text: z.string() })).optional(),
      set_params: z.record(z.string(), z.number()).optional(),
    }),
    expected_observation: z.string().optional(),
    followup_if_correct: z.string().optional(),
    followup_if_surprised: z.string().optional(),
    exit_condition: z.string(),
  })).min(2).max(6),
  verification: z.object({
    summary: z.string().describe('Plain-language statement of what must be true for the sim to be trusted'),
    probes: z.array(z.object({
      id: z.string(),
      description: z.string(),
      params: z.record(z.string(), z.number()),
      expected_metrics: z.array(z.string()).describe('Metric names expected from emitted events or final probe state'),
    })).min(2).max(8),
    invariants: z.array(z.discriminatedUnion('kind', [
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
    ])).min(2).max(8),
  }),
})

export type DesignDoc = z.infer<typeof DesignDocSchema>
```

**Behavioral verification types**
```typescript
type VerificationReport = {
  passed: boolean
  checks: VerificationCheckResult[]
  probeResults: ProbeResult[]
}

type ProbeResult = {
  probeId: string
  params: Record<string, number>
  metrics: Record<string, number>
  events: SimEvent[]
}

type VerificationCheckResult = {
  invariantId: string
  passed: boolean
  message: string
  observed?: Record<string, number>
}
```

**Internal generation pipeline contracts**

`/api/generate` is the public boundary, but the implementation should delegate the actual work to small generation modules. These contracts are internal TypeScript boundaries, not additional HTTP endpoints.

```typescript
type DesignDocConsistencyResult = {
  valid: boolean
  errors: Array<{
    path: string
    message: string
  }>
}

function validateDesignDocConsistency(designDoc: DesignDoc): DesignDocConsistencyResult
```

`DesignDocSchema` proves shape. `validateDesignDocConsistency()` proves cross-references. It must reject:

- `initial_staging.locked/highlighted` values that are not param IDs
- `socratic_plan.interaction.params` or `staging.lock/unlock/highlight/set_params` values that are not param IDs
- `socratic_plan.interaction.regions`, `target_region`, or `staging.annotate[].region` values that are not registered regions
- `socratic_plan.interaction.event` values that are not declared emitted events
- duplicate param, event, region, probe, or invariant IDs
- probe params that reference unknown param IDs or values outside the param range
- invariants that reference unknown probe IDs
- invariants that reference metrics not listed in the relevant probes' `expected_metrics`

```typescript
type GenerationAttemptTrace = {
  phase: 'pass1' | 'designDocConsistency' | 'pass2' | 'staticValidation' | 'behavioralVerification' | 'fallback'
  attempt: number
  startedAt: number
  endedAt: number
  ok: boolean
  errors?: string[]
}

type GenerationTrace = {
  concept: string
  selectedRenderer?: DesignDoc['renderer']
  attempts: GenerationAttemptTrace[]
  staticValidationRetries: number
  behavioralVerificationRetries: number
  fromTemplate: boolean
  templateId?: string
}

type GenerationResult = {
  designDoc: DesignDoc
  simCode: string
  verification: VerificationReport
  retries: number
  fromTemplate: boolean
  trace: GenerationTrace
}

async function runGenerationPipeline(
  concept: string,
  options?: { debug?: boolean },
): Promise<GenerationResult>
```

`trace` is primarily for server logs and developer/debug responses. The default student-facing response may omit it to avoid exposing prompt/debug internals.

**Pass 1 debug:** When `PRAXIO_DEBUG_GENERATION=1` or request header `x-praxio-debug: 1`, the route passes `debug` into `runGenerationPipeline`. On Pass 1 failure after all attempts, the JSON error body may include `pass1Diagnosis`: local `JSON.parse` error (if any), up to 24 Zod issue `{ path, message }` rows from re-validating the model text, optional `textPreview` (first 1500 chars of raw model output), and `localSchemaOk` when extract+Zod succeed but the AI SDK still reported schema failure (rare). Each failed attempt also logs one line to the server console: `[pass1] attempt N — …`.

`socratic_plan` is the missing middle layer between the generated simulation and
the tutor prompts. It plans the lesson around each question, not just around the
concept. Every step declares:

- what the tutor is trying to surface (`learning_goal`)
- the exact question to ask
- which student interaction should be enabled (`interaction.kind`)
- what staging the agent should apply before or during that question
- what observation or commitment lets the system move on

The UI should enable only the affordance requested by the current step when
possible. For example, a `numeric_hypothesis` step opens the estimate input,
`prediction_sketch` enables drawing over the sim, and `click_to_query` waits for
a region selection. If `activeSocraticStepId` is omitted from tutor requests, the
model infers the current step from history and pending events.

**Pass 2 retry contract**
```typescript
// On validation failure, retry Pass 2 with error context appended:
// "Previous attempt failed with: {errors.join(', ')}. Do not repeat this mistake."
// Static validation and behavioral verification have separate retry counters.
// Exhausting either budget loads a template for the closest supported domain.

type ValidationResult = {
  valid: boolean
  errors: string[]   // from validateSimModule()
}
```

Retry policy:

- Pass 1 schema failure retries Pass 1 up to a small fixed budget before failing the request; consistency failure does not retry Pass 2.
- Static validation failures retry Pass 2 with static errors only.
- Behavioral verification failures retry Pass 2 with failed invariant messages only.
- Static validation retries should not consume the behavioral verification retry budget.
- Behavioral verification retries should still run static validation before re-verifying.
- If all retries fail, select a template from the fallback registry and return `fromTemplate: true`.

**Behavioral verification contract**
```typescript
// Static validation answers: can this code safely load?
// Behavioral verification answers: does this code model the concept plausibly?
//
// The verifier runs only after validateSimModule() passes. It executes the sim in
// a headless runtime adapter, applies each designDoc.verification.probes[i].params
// configuration, records emitted metrics/events, and checks each invariant.

type BehaviorVerificationResult = VerificationReport

async function verifySimBehavior(
  simCode: string,
  designDoc: DesignDoc,
): Promise<BehaviorVerificationResult>
```

For projectile motion, Pass 1 should emit probes such as:

```json
{
  "probes": [
    { "id": "angle_30", "description": "Launch at 30 degrees under normal gravity.", "params": { "launch_angle": 30, "initial_velocity": 20, "gravity": 9.8 }, "expected_metrics": ["range_m"] },
    { "id": "angle_45", "description": "Launch at 45 degrees under normal gravity.", "params": { "launch_angle": 45, "initial_velocity": 20, "gravity": 9.8 }, "expected_metrics": ["range_m"] },
    { "id": "angle_60", "description": "Launch at 60 degrees under normal gravity.", "params": { "launch_angle": 60, "initial_velocity": 20, "gravity": 9.8 }, "expected_metrics": ["range_m"] },
    { "id": "low_gravity", "description": "Launch at 45 degrees with lower gravity.", "params": { "launch_angle": 45, "initial_velocity": 20, "gravity": 4.9 }, "expected_metrics": ["range_m"] }
  ],
  "invariants": [
    {
      "kind": "approximately_equal",
      "id": "range_symmetry_30_60",
      "description": "For equal launch and landing height, 30° and 60° should produce similar ranges.",
      "left_probe": "angle_30",
      "right_probe": "angle_60",
      "metric": "range_m",
      "tolerance_percent": 8
    },
    {
      "kind": "near_maximum",
      "id": "angle_45_near_max",
      "description": "45° should be near the maximum range among nearby tested angles.",
      "target_probe": "angle_45",
      "comparison_probes": ["angle_30", "angle_60"],
      "metric": "range_m",
      "tolerance_percent": 5
    }
  ]
}
```

**Route skeleton**
```typescript
// app/api/generate/route.ts
export async function POST(req: Request) {
  const { concept } = await req.json()
  if (typeof concept !== 'string' || concept.trim() === '') {
    return Response.json({ error: 'Concept is required', phase: 'pass1' }, { status: 400 })
  }

  const result = await runGenerationPipeline(concept.trim())

  // Keep trace server-side by default; expose it only for developer/debug mode.
  const { trace: _trace, ...studentResponse } = result
  return Response.json(studentResponse)
}
```

---

### Tutor endpoints — two-call pattern

**Trigger policy:** The tutor fires on these conditions:
1. `STUDENT_UTTERANCE` — the student finishes speaking (always triggers a full stage→speak turn).
2. `SIM_EVENT` where `event` is in `designDoc.emit_events` — discrete named events declared in the design doc (e.g. `projectile_landed`, `reached_equilibrium`). These are pedagogically meaningful moments; unnamed or undeclared events are ignored.
3. Overlay interaction events from the parent UI: `prediction_sketch_submitted`, `hypothesis_submitted`, and `focus_selected`.

`PARAM_CHANGED` messages never trigger the tutor. Current param state is read from the manifest snapshot at call time.

Each tutor turn is two sequential calls on Gemini 2.5 Flash. Call 1 is non-streaming (tools only). Call 2 is streaming (text only, grounded in Call 1's output). See `tech_stack.md` for why this split is required.

Two routes, called sequentially by the client:

#### `POST /api/tutor/stage`

Non-streaming. Returns the set of tool calls the tutor wants to apply this turn. May be an empty array for pure-speech turns.

**Request**
```typescript
type StageRequest = {
  messages: TutorMessage[]     // full conversation history
  pendingEvents: SimEvent[]    // sim events since last tutor call
  manifest: Manifest           // from iframe MANIFEST message
  designDoc: DesignDoc         // for Socratic plan + initial staging
  sessionId: string
  activeSocraticStepId?: string // optional UI-selected step; model infers if absent
}

type TutorMessage = { role: 'user' | 'assistant'; content: string }

type SimEvent = {
  event: string
  param?: string
  from?: number
  to?: number
  sim_state?: Record<string, number>
  payload?: Record<string, unknown>
  timestamp: number
}
```

In addition to iframe-originated simulation events, the parent UI may append student interaction events captured by the simulation overlay. These events use the same `pendingEvents` channel and are visible to both tutor calls:

```typescript
type OverlayInteractionEvent =
  | {
      event: 'prediction_sketch_submitted'
      payload: {
        points: Array<{ x: number; y: number }> // iframe-local CSS pixels
        coordinate_space: 'iframe_css_pixels'
      }
      timestamp: number
    }
  | {
      event: 'hypothesis_submitted'
      payload: {
        metric: string        // e.g. 'range_m', 'max_height_m', 'time_of_flight_s'
        value: number
        unit?: string
      }
      timestamp: number
    }
  | {
      event: 'focus_selected'
      payload: {
        region: string        // nearest registered region from manifest.regions
        x: number             // click position in iframe-local CSS pixels
        y: number
      }
      timestamp: number
    }
```

These overlay events do not need to be declared in `designDoc.emit_events`. They are app-level student observations, not sim-authored domain events. The tutor should treat them as commitment and attention signals: prediction sketches reveal expected shape, numerical hypotheses reveal expected magnitude, and focus selections identify what the student wants to interrogate.

**Response**
```typescript
type StageResponse = {
  toolCalls: Array<{
    toolName: string              // e.g. 'lock', 'highlight', 'set_param'
    input: Record<string, unknown>
  }>
}
```

**Route skeleton**
```typescript
// app/api/tutor/stage/route.ts
export async function POST(req: Request) {
  const { messages, pendingEvents, manifest, designDoc, activeSocraticStepId } = await req.json()

  const messagesWithEvents = appendSimEvents(messages, pendingEvents)

  const result = await generateText({
    model: google('gemini-2.5-flash'),
    system: buildCall1SystemPrompt(manifest, designDoc, activeSocraticStepId),
    messages: messagesWithEvents,
    tools: buildTutorTools(manifest),   // enum-constrained; see below
    toolChoice: 'auto',                 // allows empty toolCalls for pure-speech turns
  })

  return Response.json({
    toolCalls: result.toolCalls.map(tc => ({ toolName: tc.toolName, input: tc.input })),
  })
}
```

Client applies each tool call to `agentAPI` immediately on receipt, then calls `/api/tutor/speak`.

#### `POST /api/tutor/speak`

Streaming text-only. No tools. The system prompt includes the staging decisions from Call 1, grounding the speech in what was just staged.

**Request**
```typescript
type SpeakRequest = StageRequest & {
  appliedToolCalls: Array<{ toolName: string; input: Record<string, unknown> }>
}
```

**Response**
Streaming raw text via `toTextStreamResponse()`. Text chunks only. Note: AI SDK v6 removed `toDataStreamResponse()` — do not use it. The client reads the stream with a `ReadableStream` reader and `TextDecoder`, accumulating chunks directly (no data-stream framing to parse).

**Route skeleton**
```typescript
// app/api/tutor/speak/route.ts
export async function POST(req: Request) {
  const {
    messages,
    pendingEvents,
    manifest,
    designDoc,
    appliedToolCalls,
    activeSocraticStepId,
  } = await req.json()

  const messagesWithEvents = appendSimEvents(messages, pendingEvents)

  const result = streamText({
    model: google('gemini-2.5-flash'),
    system: buildCall2SystemPrompt(manifest, designDoc, appliedToolCalls, activeSocraticStepId),
    messages: messagesWithEvents,
    // no tools — removes text/tool competition that drops text-gen reliability
  })

  return result.toTextStreamResponse()
}
```

**Client consumption**
```typescript
const reader = speakRes.body!.getReader()
const decoder = new TextDecoder()
let fullText = ''
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  fullText += decoder.decode(value, { stream: true })
  // update UI on each chunk for word-by-word streaming
}
```

### Socratic Session Completion Contract

When all `designDoc.socratic_plan` steps are complete, the workspace enters an explicit
completion state instead of continuing the normal loop indefinitely.

**Completion criteria**

- Each step is marked complete when its `exit_condition` has been satisfied by observed
  interactions/events in the session state machine.
- Session completion occurs when every step in `socratic_plan` is complete.

**Completion response shape**
```typescript
type SessionCompletionState = {
  isComplete: boolean
  completedStepIds: string[]
  completedAt?: number
  summary?: {
    // One concise reconciliation turn grounded in the student's actions.
    synthesis: string
    // One transfer check to test understanding in a new condition.
    transferQuestion: string
  }
}
```

**Post-completion tutor behavior**

- The tutor emits one short synthesis turn grounded in what the student did
  (prediction/manipulation/observation), not a generic recap.
- The tutor then asks one transfer question that changes conditions while preserving
  the core concept.
- After the transfer response, tutor calls become user-driven (e.g. replay/challenge),
  not automatic step progression.

**Persistence artifact (per workspace session)**

Store a compact completion artifact for retrieval and future UX:

```typescript
type SessionLearningArtifact = {
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
```

**UI actions exposed on completion**

- `try_challenge` — run the transfer-check path (if not already answered)
- `replay_step` — reopen a specific step in `socratic_plan`
- `new_concept` — navigate back to landing

---

## Tutor Tool Definitions

Tools are built **dynamically per session** from the manifest. All `element_id`, `name`, and `region` fields are Zod enums constrained to valid values from the manifest. This is a defense-in-depth measure against ID paraphrasing — spike data showed strict prompting alone only achieved 3/5 exact-ID rate on Gemini 2.5 Flash.

```typescript
import { tool } from 'ai'
import { z } from 'zod'

export function buildTutorTools(manifest: Manifest) {
  const paramNames = manifest.params.map(p => p.name) as [string, ...string[]]
  const regionNames = manifest.regions as [string, ...string[]]
  const eventNames = manifest.events as [string, ...string[]]

  return {
    set_param: tool({
      description: 'Move a slider or set a variable to a specific value',
      parameters: z.object({
        name: z.enum(paramNames).describe('Param name from the manifest — must be verbatim'),
        value: z.number().describe('New value within the param range'),
      }),
    }),

    lock: tool({
      description: 'Remove a control from student reach temporarily to reduce degrees of freedom',
      parameters: z.object({
        element_id: z.enum(paramNames).describe('Param name to lock — must be verbatim'),
      }),
    }),

    unlock: tool({
      description: 'Restore a previously locked control to the student',
      parameters: z.object({
        element_id: z.enum(paramNames),
      }),
    }),

    highlight: tool({
      description: 'Apply visual emphasis (glow, border) to a parameter control in the sidebar to direct student attention. Params only — use add_annotation to call attention to a region inside the simulation.',
      parameters: z.object({
        element_id: z.enum(paramNames),
      }),
    }),

    add_annotation: tool({
      description: 'Pin a text label to a named simulation region',
      parameters: z.object({
        region: z.enum(regionNames).describe('Region name from the manifest — must be verbatim'),
        text: z.string().describe('Label or question to display'),
      }),
    }),

  clear_annotations: tool({
    description: 'Remove all active annotations from the simulation',
    parameters: z.object({}),
  }),

  checkpoint: tool({
    description: 'Snapshot full simulation state for what-if branching. Returns an opaque checkpoint ID — save it to call restore() later.',
    parameters: z.object({}),
  }),

  restore: tool({
    description: 'Rewind simulation to a previous checkpoint',
    parameters: z.object({
      id: z.string().describe('Opaque checkpoint ID returned by a prior checkpoint call — must be verbatim, do not guess or construct'),
    }),
  }),

    trigger_event: tool({
      description: 'Introduce a perturbation into the simulation (e.g. a third body appears)',
      parameters: z.object({
        type: z.enum(eventNames).describe('Event type from the manifest — must be verbatim'),
      }),
    }),

    set_scene: tool({
      description: 'Reset the simulation to a new initial condition for a different pedagogical setup',
      parameters: z.object({
        config: z.record(z.enum(paramNames), z.number()).describe('Param name → value overrides'),
      }),
    }),

    // Only include pause/play when manifest.animates is true
    ...(manifest.animates ? {
      pause: tool({
        description: 'Freeze the animation loop. Use before add_annotation to let the student examine a frozen frame before answering. The sim remains visible.',
        parameters: z.object({}),
      }),

      play: tool({
        description: 'Resume the animation loop from current state. Use after the student has answered to continue discovery.',
        parameters: z.object({}),
      }),
    } : {}),
  }
}
```

**Client-side tool application**

Call 1 returns a JSON payload of tool calls; the client applies each to `agentAPI` before invoking Call 2. Call 2 is text-only — chunks are appended to the chat and queued for TTS:

```typescript
// Call 1
const { toolCalls } = await fetch('/api/tutor/stage', { method: 'POST', body: ... }).then(r => r.json())

// Apply each tool call. checkpoint() is special: the iframe responds with CHECKPOINT_SAVED { id },
// which we capture and splice back into the tool call as a tool-result before Call 2.
// This lets the model reference the ID in future restore() calls.
const appliedToolCalls: AppliedToolCall[] = []
for (const { toolName, input } of toolCalls) {
  if (toolName === 'checkpoint') {
    const id = await applyCheckpointAndWait()   // postMessage + wait for CHECKPOINT_SAVED
    appliedToolCalls.push({ toolName, input, result: { id } })
  } else {
    agentAPI[toolName](input)
    appliedToolCalls.push({ toolName, input, result: null })
  }
}

type AppliedToolCall = {
  toolName: string
  input: Record<string, unknown>
  result: { id: string } | null   // non-null only for checkpoint
}

// Call 2
const stream = await fetch('/api/tutor/speak', { method: 'POST', body: bodyWithAppliedToolCalls })
for await (const chunk of parseDataStream(stream.body)) {
  if (chunk.type === 'text-delta') {
    appendToChat(chunk.textDelta)
    queueForTTS(chunk.textDelta)
  }
}
```

---

## Tutor System Prompt Contracts

Two system prompts, both built dynamically from the manifest after the iframe sends `MANIFEST`. Regenerated each session, never hardcoded.

### Call 1 — Staging prompt (tools only, no speech)

```typescript
function buildCall1SystemPrompt(
  manifest: Manifest,
  designDoc: DesignDoc,
  activeSocraticStepId?: string,
): string {
  return `
You are the staging half of a Socratic tutor. Your ONLY job this turn is to decide
which sim actions (if any) to fire. Do not speak. Do not explain. Return tool calls
only. If no staging is needed for this turn, return zero tool calls — another call
will handle the speech.

SIMULATION PARAMETERS you can control:
${manifest.params.map(p =>
  `  - ${p.name} (${p.min}–${p.max} ${p.unit ?? ''}): currently ${p.default}`
).join('\n')}

ANNOTATION TARGETS: ${manifest.regions.join(', ')}

EVENTS you can receive:
${manifest.events.map(e => `  - ${e}`).join('\n')}
  - param_changed { param, from, to, sim_state }

SOCRATIC PLAN:
${formatSocraticPlan(designDoc)}

CURRENT STEP: ${activeSocraticStepId ?? 'infer the next unfinished step from history and pending events'}

RULES:
  - Tool arguments MUST use the exact IDs listed above, verbatim. No suffixes like
    "_slider". No paraphrasing.
  - Stage according to the current best Socratic plan step, not a generic tutoring move.
  - Apply that step's staging when it has not already been applied.
  - For prediction_sketch and numeric_hypothesis steps, prefer zero tool calls after
    the commitment is already present; the speech call should reconcile prediction
    against observation.
  - For click_to_query steps, prioritize the selected region before broadening scope.
  - Use lock() to reduce degrees of freedom only when the current step calls for it.
  - If the student is mid-discovery, returning zero tool calls is often correct.
  `.trim()
}
```

### Call 2 — Speech prompt (text only, grounded in Call 1)

```typescript
function buildCall2SystemPrompt(
  manifest: Manifest,
  designDoc: DesignDoc,
  appliedToolCalls: Array<{ toolName: string; input: Record<string, unknown> }>,
  activeSocraticStepId?: string,
): string {
  const stagingSummary = appliedToolCalls.length === 0
    ? 'You chose not to stage anything this turn. Respond with a Socratic move only.'
    : 'You just staged the scene by calling:\n' +
      appliedToolCalls.map(tc => `  - ${tc.toolName}(${JSON.stringify(tc.input)})`).join('\n')

  return `
You are the speaking half of a Socratic tutor. You have no tools this turn; only
text. Another call already applied the sim staging below.

${stagingSummary}

HARD RULES:
  - NEVER explain the concept directly. You are forbidden from declarative answers.
  - Respond with a question, a prediction prompt, or a directive to manipulate the
    sim ("drag the angle slider and tell me what you see").
  - Only confirm/validate when the student has clearly arrived at the answer
    themselves. Then open the next thread.
  - Speak in short sentences, not paragraphs. One question per turn.
  - Ground your speech in the staging above. If you highlighted launch_angle, your
    question should be about launch angle, not something else.

SIMULATION CONTEXT:
${manifest.params.map(p =>
  `  - ${p.name} (${p.min}–${p.max} ${p.unit ?? ''})`
).join('\n')}

SOCRATIC PLAN:
${formatSocraticPlan(designDoc)}

CURRENT STEP: ${activeSocraticStepId ?? 'infer the next unfinished step from history and pending events'}
  `.trim()
}
```

---

## postMessage Protocol (Parent ↔ iframe)

Full specification is in `simulation-runtime-sdk.md`. Contracts summarized here for reference.

**Parent → iframe**
```typescript
type AgentCmd =
  | { type: 'LOAD_SIM';    code: string }
  | { type: 'TRACK_REGIONS'; enabled: boolean }
  | { type: 'AGENT_CMD';   action: 'set_param';  target: string; value: number }
  | { type: 'AGENT_CMD';   action: 'lock';        target: string }
  | { type: 'AGENT_CMD';   action: 'unlock';      target: string }
  | { type: 'AGENT_CMD';   action: 'highlight';   target: string }
  | { type: 'AGENT_CMD';   action: 'annotate';    region: string; text: string }
  | { type: 'AGENT_CMD';   action: 'clear_annotations' }
  | { type: 'AGENT_CMD';   action: 'checkpoint' }
  | { type: 'AGENT_CMD';   action: 'restore';     id: string }
  | { type: 'AGENT_CMD';   action: 'trigger_event'; eventType: string }
  | { type: 'AGENT_CMD';   action: 'set_scene';   config: Record<string, number> }
  | { type: 'AGENT_CMD';   action: 'pause' }
  | { type: 'AGENT_CMD';   action: 'play' }
  | { type: 'AGENT_CMD';   action: 'launch' }   // episodic only — triggers onLaunch callback
  | { type: 'AGENT_CMD';   action: 'reset' }    // episodic only — triggers onReset callback
```

**iframe → parent**
```typescript
type IframeMessage =
  | { type: 'MANIFEST';         params: ParamDef[]; regions: string[]; events: string[]; animates: boolean }
  | { type: 'PARAM_CHANGED';    param: string; from: number; to: number; sim_state: Record<string, number> }
  | { type: 'SIM_EVENT';        event: string; payload: Record<string, unknown>; timestamp: number }
  | { type: 'REGION_POSITIONS'; regions: Record<string, { x: number; y: number } | null> }
  | { type: 'CHECKPOINT_SAVED'; id: string }   // opaque ID, e.g. "ckpt_a4f2" — client feeds back as tool-result
  | { type: 'SIM_PAUSED' }
  | { type: 'SIM_RESUMED' }
  | { type: 'SIM_PHASE';        phase: 'idle' | 'active' | 'done' }  // episodic only
  | { type: 'SIM_ERROR';        error: string }

type ParamDef = {
  name: string
  min: number
  max: number
  default: number
  label: string
  unit?: string
}

type Manifest = {
  params: ParamDef[]
  regions: string[]
  events: string[]
  animates: boolean   // true for p5/canvas2d/matter; false for jsxgraph
  episodic: boolean   // true when sim registered onLaunch/onReset; parent shows Launch/Reset in SimControls
}
```

`TRACK_REGIONS` enables throttled region-position streaming only while parent UI has active region highlights or annotations. Each `REGION_POSITIONS` coordinate is in iframe-local CSS pixels, matching the overlay coordinate space.

---

## ElevenLabs API

### STT — Scribe (client-side)

```typescript
// Called after MediaRecorder produces an audio blob
const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
  method: 'POST',
  headers: { 'xi-api-key': process.env.NEXT_PUBLIC_ELEVENLABS_KEY! },
  body: formData,   // multipart: { audio: Blob, model_id: 'scribe_v1' }
})
const { text } = await response.json()
```

### TTS — Streaming (client-side)

```typescript
const VOICE_ID = 'your-chosen-voice-id'   // set in env

const response = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
  {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.NEXT_PUBLIC_ELEVENLABS_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: tutorText,
      model_id: 'eleven_turbo_v2_5',
      output_format: 'mp3_44100_128',
    }),
  }
)

const reader = response.body!.getReader()
// Feed chunks to Web Audio API or an <audio> element with a MediaSource
```

---

## MongoDB Operations

### Connection

```typescript
// lib/mongodb.ts — singleton cached across hot reloads
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
```

### Collection Schemas (TypeScript)

```typescript
type Workspace = {
  _id: ObjectId
  sessionId: string
  concept: string
  domain: string
  renderer: 'p5' | 'canvas2d' | 'jsxgraph' | 'matter'
  designDoc: DesignDoc
  createdAt: Date
}

type Branch = {
  _id: ObjectId
  workspaceId: ObjectId
  sessionId: string
  name: string
  checkpoints: Checkpoint[]
  conversationHistory: TutorMessage[]
  createdAt: Date
}

type Checkpoint = {
  id: string               // opaque ID, e.g. "ckpt_a4f2" — must match what iframe returned
  paramValues: Record<string, number>
  internalState: unknown   // sim-specific, opaque to the backend
  savedAt: Date
}

type SimEvent = {
  _id: ObjectId
  branchId: ObjectId
  event: string
  param?: string
  from?: number
  to?: number
  sim_state?: Record<string, number>
  payload?: Record<string, unknown>
  timestamp: number
}
```

### Key Operations

```typescript
// Save workspace after generation completes
await db.collection<Workspace>('workspaces').insertOne({
  sessionId,
  concept,
  domain: designDoc.domain,
  renderer: designDoc.renderer,
  designDoc,
  createdAt: new Date(),
})

// Save checkpoint
await db.collection<Branch>('branches').updateOne(
  { _id: branchId },
  { $push: { checkpoints: { index, paramValues, internalState, savedAt: new Date() } } }
)

// Append tutor message
await db.collection<Branch>('branches').updateOne(
  { _id: branchId },
  { $push: { conversationHistory: { role, content } } }
)

// Log sim event (fire-and-forget — don't await in the hot path)
db.collection<SimEvent>('simEvents').insertOne({ branchId, ...event })
```

### Indexes

```typescript
// Run once at startup or in a migration script
await db.collection('workspaces').createIndex({ sessionId: 1 })
await db.collection('branches').createIndex({ workspaceId: 1 })
await db.collection('simEvents').createIndex({ branchId: 1, timestamp: 1 })
// TTL — expire sessions after 24h
await db.collection('workspaces').createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 })
```

---

## Code Validation Contract

Runs between Pass 2 output and `LOAD_SIM` dispatch. Source of truth is `src/runtime/validation.ts`.

```typescript
type ValidationResult = {
  valid: boolean
  errors: string[]
}

function validateSimModule(code: string): ValidationResult {
  const checks = [
    { test: /registerParam/.test(code),       error: 'No params registered' },
    { test: /onUpdate|onRender/.test(code),   error: 'No update or render loop' },
    { test: !/document\./.test(code),         error: 'Illegal DOM access' },
    { test: !/window\./.test(code),           error: 'Illegal window access' },
    { test: !/import /.test(code),            error: 'Illegal import statement' },
    { test: !/require\(/.test(code),          error: 'Illegal require call' },
  ]
  const errors = checks.filter(c => !c.test).map(c => c.error)
  return { valid: errors.length === 0, errors }
}
```

---

## Environment Variables

```bash
# .env.local

# Server-side only
GOOGLE_GENERATIVE_AI_API_KEY=   # Google AI Studio — Gemma 4 via @ai-sdk/google
MONGODB_URI=                    # MongoDB Atlas connection string

# Client-side (NEXT_PUBLIC_ prefix — acceptable for demo)
NEXT_PUBLIC_ELEVENLABS_KEY=     # ElevenLabs STT + TTS
NEXT_PUBLIC_ELEVENLABS_VOICE_ID=# Chosen tutor voice
```
