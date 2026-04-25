# Tech Stack
### Praxio — LA Hacks 2026

---

## Core Dependencies

| Layer | Package | Version | Role |
|---|---|---|---|
| Framework | `next` | 15.x | App Router, API routes, SSR |
| Language | `typescript` | 5.x | Type safety across client + server |
| AI SDK | `ai` | 4.x | Vercel AI SDK core |
| AI provider | `@ai-sdk/google` | latest | Gemma 4 via Google AI Studio |
| Schema validation | `zod` | 3.x | Curriculum/verification-spec schemas, tool param schemas |
| Simulation | `p5` | 1.x | Physics / motion / biology renderer |
| Simulation | `jsxgraph` | 1.x | Math / calculus / geometry renderer |
| Simulation | `matter-js` | 0.19.x | Rigid body physics renderer |
| Voice | `elevenlabs` | latest | STT (Scribe) + TTS (streaming) |
| Database | `mongodb` | 6.x | Direct driver — no Mongoose |
| Styling | `tailwindcss` | 4.x | UI layout and components |
| Package manager | `pnpm` | 9.x | Workspace management |

canvas2d is the native browser API — no package needed.

---

## AI Layer

### Models: Gemma 4 31B-it + Gemini 2.5 Flash (Google AI Studio)

Roles are split across two models based on measured behavior. Both ship via `@ai-sdk/google`:

```typescript
import { google } from '@ai-sdk/google'

const genModel   = google('gemma-4-31b-it')    // curriculum, verification-spec, sim-builder
const tutorModel = google('gemini-2.5-flash')  // Socratic tutor (two-call)
```

**Why the split (from `spikes/gemma-tools-v2/` and `spikes/gemini-tutor/`):**

- Gemma 4 31B-it: tool calls fire at 100%, but total latency is 10–20s and text-generation rate drops to 40% when tools are also requested. Fine for one-shot generation, unusable for the latency-sensitive tutor loop.
- Gemini 2.5 Flash: ~1.4s median total latency. Native tool calls work, but it also emits text-then-tools (not interleaved) and text≥1 is only 10% when tools are requested in the same call. The two-call pattern below mitigates both issues.
- Neither model interleaves text and tools in a single streamed response. The two-call pattern is not a Gemma workaround — it is the correct architecture for this provider regardless of model choice.

**Curriculum Agent — Concept → Design Doc Core** (Gemma 4 31B-it)
Uses `generateObject` with a Zod schema:

```typescript
import { generateObject } from 'ai'

const { object: designDoc } = await generateObject({
  model: genModel,
  schema: designDocSchema,   // Zod schema — see api_contracts.md
  prompt: concept,
  system: CURRICULUM_SYSTEM_PROMPT,
})
```

**Verification-Spec Agent — Design Doc Core → Verification Block** (Gemma 4 31B-it)

```typescript
const { object: verification } = await generateObject({
  model: genModel,
  schema: verificationSchema,
  prompt: JSON.stringify(designDocCore),
  system: VERIFICATION_SPEC_SYSTEM_PROMPT,
})
```

**Sim-Builder Agent — Full Design Doc → Sim Code** (Gemma 4 31B-it)

```typescript
import { generateText } from 'ai'

const { text: simCode } = await generateText({
  model: genModel,
  system: SIM_BUILDER_SYSTEM_PROMPT + '\n\nDESIGN DOCUMENT:\n' + JSON.stringify(designDoc),
  prompt: 'Generate the simulation module.',
})
```

**Behavioral Verification — Sim Code → Trusted Model**

After static validation passes, the generated sim is executed in a headless runtime adapter against the `designDoc.verification` probes and invariants. This step does not use an LLM as the primary judge. It checks deterministic behavior: emitted metrics, event timing, monotonic relationships, approximate equalities, extrema, and closed-form anchor cases where available.

```typescript
const verification = await verifySimBehavior(simCode, designDoc)

if (!verification.passed) {
  // Retry sim-builder agent with concrete failed invariants as feedback.
  // Fall back to a pre-verified template after the retry budget.
}
```

This is the truth-grounding layer for the Cognition track: static validation proves that the code is runnable; behavioral verification proves that the generated tool behaves like the declared model closely enough to teach from.

**Socratic Tutor — Two-Call Pattern** (Gemini 2.5 Flash)

Each tutor turn is two sequential calls. Call 1 decides what sim actions to fire; Call 2 speaks the Socratic move grounded in Call 1's decisions. Call 2 is streamed so ElevenLabs TTS starts playing as soon as the first text chunk arrives.

```typescript
import { generateText, streamText } from 'ai'

// Call 1 — tools only, no speech
const staging = await generateText({
  model: tutorModel,
  system: buildCall1SystemPrompt(manifest, designDoc),
  messages: messagesWithEvents,
  tools: tutorTools,
  toolChoice: 'auto',   // allows zero tool calls for pure-speech turns
})

// Apply Call 1's tool calls to the iframe immediately (may be empty)
for (const tc of staging.toolCalls) agentAPI[tc.toolName](tc.input)

// Call 2 — text only, grounded in Call 1's staging
const speech = streamText({
  model: tutorModel,
  system: buildCall2SystemPrompt(manifest, designDoc, staging.toolCalls),
  messages: messagesWithEvents,
  // no tools — removes text/tool competition that drops text-gen reliability to 10–40%
})
```

**ID drift mitigation.** Spike data showed strict prompting alone got only 3/5 exact IDs on Gemini. Tool parameter schemas for `lock`, `unlock`, `highlight`, `set_param.name`, and annotation regions are defined as Zod enums built dynamically from the manifest — defense-in-depth against paraphrased arguments.

**Optional optimization (post-MVP).** Skip Call 1 when there is no plausible staging action (e.g., no `param_changed` events and no sim-emitted events since the last turn). Go straight to a text-only call. Cuts average turn latency roughly in half. Not required for the demo.

---

## Simulation Layer

### Renderer Selection

The curriculum agent selects the renderer based on concept domain. The client loads the matching iframe template:

```
designDoc.renderer → iframe src
  'p5'        → /iframe/p5.html
  'canvas2d'  → /iframe/canvas2d.html
  'jsxgraph'  → /iframe/jsxgraph.html
  'matter'    → /iframe/matter.html
```

Each iframe HTML template pre-loads its renderer library as a script tag, then loads `simRuntime.js`. The generated sim code is the same API surface regardless of renderer — only the context passed to `onRender` differs.

### p5.js
- Best for: projectile motion, orbital mechanics, particle systems, wave propagation, biology sims
- Context passed to `onRender`: `p5` instance
- p5 is loaded in instance mode to avoid polluting the iframe global scope

### JSXGraph
- Best for: derivatives / tangent lines, integrals, parametric curves, function plots, geometric constructions, linear transformations
- Context passed to `onRender`: JSXGraph board instance
- Replaces Mafs — JSXGraph is vanilla JS, no React dependency, works with `new Function()` execution
- Native support for draggable points, dynamic labels, and function graphing makes it ideal for the calculus demo

### Matter.js
- Best for: pendulums, springs, collisions, inclined planes, Newton's cradle, fluid approximations
- Context passed to `onRender`: Matter `{ engine, render, runner }` composite
- Provides a real rigid body physics engine where p5.js would require manual physics implementation

### canvas2d
- Best for: membrane diffusion, custom geometric drawing, concentration gradients, heat maps
- Context passed to `onRender`: `CanvasRenderingContext2D`
- Fallback renderer when no other fits

---

## Voice Layer

### ElevenLabs SDK (`elevenlabs`)

**STT — Scribe**
Transcribes student speech. Called client-side via the ElevenLabs SDK. The microphone toggle gates this — keyboard input is always available as a fallback.

```typescript
import { ElevenLabsClient } from 'elevenlabs'

const client = new ElevenLabsClient({ apiKey: process.env.NEXT_PUBLIC_ELEVENLABS_KEY })

const transcript = await client.speechToText.convert({
  audio: audioBlob,    // recorded from MediaRecorder
  model_id: 'scribe_v1',
})
```

**TTS — Streaming**
Tutor text is streamed from `/api/tutor`. As each text chunk arrives, it is queued to ElevenLabs TTS. Playback begins before the full response is complete, keeping perceived latency under 2 seconds.

```typescript
const audioStream = await client.textToSpeech.convertAsStream(voiceId, {
  text: tutorChunk,
  model_id: 'eleven_turbo_v2_5',
  output_format: 'mp3_44100_128',
})
```

The voice key is exposed client-side for the demo. If time allows, proxy through a `/api/tts` route.

---

## Persistence Layer

### MongoDB Atlas — Direct Driver

No Mongoose. The `mongodb` driver is used directly. Three collections:

```
workspaces   concept metadata + design doc
branches     checkpoint stack + conversation history (inline, no joins)
simEvents    raw event log per branch
```

A single `MongoClient` instance is cached in a module-level variable to survive Next.js hot reloads in development:

```typescript
// lib/mongodb.ts
import { MongoClient } from 'mongodb'

const client = new MongoClient(process.env.MONGODB_URI!)
export const db = client.db('praxio')
```

Session identity: UUID in `localStorage`, no auth required.

---

## Dev Tooling

| Tool | Purpose |
|---|---|
| `pnpm` | Package manager + workspace |
| `typescript` | Type checking across client + server |
| `eslint` | Linting (Next.js config) |
| `prettier` | Formatting |
| Headless verification harness | Runs generated sims against probe cases and invariants before loading them for students |
| Vercel CLI | `vercel dev` for local API route testing |

---

## What's Not Here (and Why)

| Skipped | Reason |
|---|---|
| Mongoose | Direct driver is sufficient; Mongoose schema layer adds no value for 3 collections at demo scale |
| Mafs | React component library — incompatible with `new Function()` iframe execution. JSXGraph covers the same domain without framework dependency |
| tRPC / GraphQL | Overkill — two API routes cover the entire server surface |
| Auth (NextAuth, Clerk) | Not needed; localStorage UUID is sufficient for a demo |
| Redis | No session caching needed at hackathon scale |
| Docker | Vercel handles deployment; no container needed |
