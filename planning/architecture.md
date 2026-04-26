# Architecture
### Praxio — LA Hacks 2026

---

## System Overview

Praxio is a Next.js application (App Router) with no separate backend process. API routes handle all server-side work: simulation generation and the Socratic tutor stream. The simulation itself runs in an iframe sandbox isolated from the parent React app.

---

## Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        Vercel Edge / Node                        │
│                                                                  │
│   /api/generate          /api/tutor                             │
│   Curriculum + Sim Builder (+ Verification Spec)                │
│                          Two-call tutor turn                    │
│   Gemma 4 31B-it         Call 1: tools (generateText)           │
│   generateObject         Call 2: text  (streamText)             │
│   Behavioral verifier    Gemini 2.5 Flash via @ai-sdk/google    │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS (streaming)
┌──────────────────────────────▼──────────────────────────────────┐
│                        Next.js Client                            │
│                                                                  │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │  Branch Sidebar  │  │  SimContainer    │  │  TutorPanel    │  │
│  │  (workspaces,    │  │  (iframe wrap +  │  │  (chat +       │  │
│  │   checkpoints)   │  │   slider UI)     │  │   voice)       │  │
│  └─────────────────┘  └────────┬─────────┘  └───────┬────────┘  │
│                                │ postMessage          │           │
│                       ┌────────▼─────────┐           │           │
│                       │    iframe         │           │           │
│                       │  simRuntime.js    │           │           │
│                       │  + generated sim  │           │           │
│                       │  p5 | canvas2d |  │           │           │
│                       │  jsxgraph | matter│           │           │
│                       └──────────────────┘           │           │
└──────────────────────────────────────────────────────┼───────────┘
                                                        │ REST
                               ┌────────────────────────▼──────────┐
                               │         ElevenLabs                  │
                               │  STT: Scribe  |  TTS: stream       │
                               └───────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                        MongoDB Atlas                              │
│  workspaces · branches · simEvents                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### API Routes (server-side)

**`/api/generate`**
Runs the simulation generation orchestration. Accepts a concept string, returns a design document and sim code string. Keeps the Google AI Studio key server-side. The route should stay thin: request parsing, response shaping, and calling the generation pipeline.

- Curriculum agent: `generateObject` → typed design doc JSON (Zod schema enforced)
- Verification-spec agent: `generateObject` → `verification` block (probes/invariants)
- Design-doc consistency checks: verify internal ID references before code generation
- Sim-builder agent: `generateText` → sim code string
- Static validation after sim-builder generation; retry sim-builder with static error context
- Behavioral verification after static validation; generated code must satisfy the design doc's probe cases and invariants
- Template fallback when generation cannot produce a statically valid and behaviorally verified sim
- Generation trace records attempts, failures, fallback choice, and timings for debugging

Static validation answers "can this code safely load in the runtime?" Behavioral verification answers "does this simulation behave like the concept it claims to model?" Both are required before the sim is handed to the tutor.

Internal responsibilities should be split by concern rather than accumulated inside the route:

| Responsibility | Purpose |
|---|---|
| Design-doc generation | Convert raw concept into schema-valid `DesignDoc` |
| Design-doc consistency validation | Catch bad cross-references: missing params, regions, events, probes, or invariant targets |
| Sim-code generation | Produce sandbox-safe JavaScript from a verified design doc |
| Static validation | Check syntax/runtime-shape constraints before any iframe or headless execution |
| Behavioral verification | Run deterministic probes against generated behavior |
| Retry orchestration | Decide which feedback to send to the sim-builder agent and maintain separate failure context |
| Template fallback registry | Return a known-good sim when model generation exhausts its budget |
| Generation trace | Preserve attempt-level observability without leaking implementation details to the client |

**`/api/tutor`**
Socratic tutor endpoint. Runs a two-call pattern per turn on Gemini 2.5 Flash:

1. **Call 1 — staging** (`generateText`, tools, `toolChoice: 'auto'`): decides which sim actions to fire this turn. May return zero tool calls for pure-speech turns. Response is returned to the client as a non-streamed JSON payload of tool calls.
2. **Call 2 — speech** (`streamText`, no tools): streams the Socratic question, grounded in Call 1's tool calls via the system prompt. Client pipes chunks to ElevenLabs TTS.

Splitting the turn is forced by a finding from `spikes/gemini-tutor/` and `spikes/gemma-tools-v2/`: Google's models emit text-then-tools (not interleaved) and text-generation reliability collapses to 10–40% when tools are available in the same call. Call 2 has no tools, restoring text reliability to ~100%. The client applies Call 1's tool calls before Call 2's stream reaches the speaker, matching the demo-moment ordering (stage → speak).

The tutor is implemented as two routes (`/api/tutor/stage`, `/api/tutor/speak`) called sequentially by the client. Contracts are in `api_contracts.md`.

---

### Client Components

**`SimContainer`**
- Owns the iframe element (sandboxed, no `allow-same-origin`)
- Receives the sim code string and sends `LOAD_SIM` via postMessage
- Listens for `MANIFEST` and builds the slider UI dynamically
- Translates incoming `agentAPI` calls into `AGENT_CMD` postMessages
- Routes `SIM_EVENT` and `PARAM_CHANGED` messages upstream to the tutor loop
- Owns the parent-side simulation overlay for prediction sketching, numerical hypothesis input, and click-to-query. These interactions append structured events to the tutor loop but do not require generated sim code changes.

**`TutorPanel`**
- Displays the conversation history
- Streams tutor text responses via `useChat` or manual `ReadableStream` consumption
- Passes streamed text to ElevenLabs TTS for voice output
- Contains the microphone toggle (ElevenLabs STT on/off)

**`Branch Sidebar`**
- Lists workspaces and named branches
- Checkpoint restore triggers `agentAPI.restore(index)`

---

### Simulation Layer (iframe-isolated)

The iframe is a static HTML file pre-loaded with `simRuntime.js` and the selected renderer library. On `LOAD_SIM`, the bootstrap executes the generated code via `new Function('runtime', code)`. The runtime never touches the parent DOM.

Renderer selection is made by the curriculum agent based on concept domain:

| Domain | Renderer | Library pre-loaded in iframe |
|---|---|---|
| Physics / motion | `p5` | p5.js |
| Biology / custom drawing | `canvas2d` | none (native) |
| Math / calculus / geometry | `jsxgraph` | JSXGraph |
| Rigid body / mechanics | `matter` | Matter.js |

Each renderer variant is a separate iframe HTML template (`iframe-p5.html`, `iframe-jsxgraph.html`, etc.). The parent loads the correct one based on `designDoc.renderer`.

---

## Data Flows

### 1. Simulation Generation

```
User types/speaks concept
        │
        ▼ (STT if voice)
ElevenLabs Scribe → transcript string
        │
        ▼
POST /api/generate { concept, sessionId }  (optional `?stream=1` → NDJSON progress_step_* events)
        │
        ├── Curriculum agent: generateObject → DesignDoc core JSON
        │     (renderer, params, equations, staging, Socratic plan)
        │
        ├── Verification-spec agent: generateObject → verification JSON
        │     (probes, invariants, metric expectations)
        │
        ├── validateDesignDocConsistency() → errors[]
        │     (param/region/event/probe/invariant references must line up)
        │
        ├── Sim-builder agent: generateText → sim code string
        │     (full SDK spec + design doc in system prompt)
        │
        ├── validateSimModule() → errors[]
        │     (retry sim-builder agent with static error context)
        │
        ├── verifySimBehavior() → invariant results[]
        │     (runs deterministic probes in a headless runtime)
        │     (retry sim-builder agent with failed invariants as feedback)
        │
        ├── getTemplateForDomain() if retry budgets exhaust
        │
        ├── GenerationTrace
        │     (attempts, validation failures, verification failures, fallback)
        │
└── { designDoc, simCode, verification }
              │
              ▼
Client navigates to workspace; overlay until iframe posts MANIFEST (runtime ready)
        │
        ▼
Client selects iframe template by designDoc.renderer
Client sends postMessage { type: 'LOAD_SIM', code: simCode }
        │
        ▼
iframe executes sim → sends MANIFEST
        │
        ▼
Parent builds slider UI + constructs agent system prompt from manifest
        │
        ▼
Apply initial_staging: lock(), highlight() from designDoc
        │
        ▼
POST /api/tutor → opening Socratic question (streamed)
→ ElevenLabs TTS plays question aloud
```

### 1a. Behavioral Verification

Behavioral verification is part of generation, not a tutor-time feature. The design doc must include enough truth-grounding information to test the generated simulation:

- `governing_equations`: human-readable domain equations
- `verification.probes`: deterministic input configurations to run
- `verification.invariants`: relationships that should hold across probe outputs
- per-invariant tolerances: acceptable numeric error for approximate simulations

The verifier runs the generated sim in a headless runtime adapter that implements the same SDK surface as the iframe runtime but records param values, emitted events, and final metrics instead of rendering pixels. It executes each probe, compares observed metrics to the expected relationships, and returns a structured report. Failed checks are appended to the sim-builder retry prompt:

```
Previous attempt failed behavioral verification:
- range_symmetry_30_60: expected ranges within 5%, observed 42.1m vs 27.4m
- gravity_monotonicity: expected range to decrease as gravity increases
Do not repeat these mistakes.
```

After the retry budget is exhausted, `/api/generate` returns a pre-verified template for the nearest supported domain. The student should never receive an unverified generated simulation unless explicitly running a developer/debug mode.

### 2. Socratic Tutor Loop

```
Student sketches prediction / enters hypothesis / clicks region / manipulates slider
        │
        ▼
parent overlay captures prediction/focus events
or iframe runtime detects sim changes
postMessage PARAM_CHANGED / SIM_EVENT, or overlay event → parent
        │
        ▼
Parent appends event to conversation context
POST /api/tutor { messages: [...], pendingEvents: [...] }
        │
        ├── Call 1 (Gemini 2.5 Flash, tools, no text)
        │     returns toolCalls[] (may be empty)
        │     → for each tc: agentAPI[tc.name](tc.input)
        │       → postMessage AGENT_CMD to iframe
        │       → iframe applies command (lock, highlight, set_param, …)
        │
        └── Call 2 (Gemini 2.5 Flash, streamText, no tools)
              system prompt includes Call 1's tool calls as context
              streams text chunk-by-chunk
              → TutorPanel display + ElevenLabs TTS queue
              → first TTS audio plays ~instantly after staging lands
        │
        ▼
Loop continues until concept is understood
```

### 3. Checkpoint / Branch

```
agentAPI.checkpoint()
        │
        ▼
iframe runtime snapshots { paramValues, internalState }
postMessage CHECKPOINT_SAVED { index, snapshot } → parent
        │
        ▼
Parent saves to MongoDB branches.checkpoints[]
        │
        ▼
agentAPI.restore(index)
        │
        ▼
postMessage AGENT_CMD { action: 'restore', index } → iframe
iframe rewinds to snapshot
```

---

## Session Identity

No authentication for the demo. A UUID is generated on first visit and stored in `localStorage`. All workspaces and branches are keyed to this session UUID. MongoDB TTL index expires sessions after 24 hours.

---

## Deployment

Single Vercel project. No Docker, no separate services to stand up.

```
vercel deploy
```

Environment variables needed:
```
GOOGLE_GENERATIVE_AI_API_KEY=  # Google AI Studio — used by @ai-sdk/google
ELEVENLABS_API_KEY=            # ElevenLabs — used by TTS/STT API routes
MONGODB_URI=                   # MongoDB Atlas connection string
```

ElevenLabs calls go directly from the client (acceptable for demo — key not exposed because the API key is not sent to the client; voice calls can be proxied through an API route if time allows).
