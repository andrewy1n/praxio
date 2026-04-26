# Praxio — Agent Context

## What This Project Is

An AI-powered learning tool that generates bespoke interactive simulations on demand for any concept a student is stuck on, then guides them through Socratic discovery using a voice tutor. The tutor never explains — it asks questions and manipulates the simulation to stage discovery.

---

## Read These Before Writing Code

The planning docs are the source of truth. Read the relevant one before implementing anything in its domain — do not invent API shapes, model choices, or SDK contracts.

| Doc | Read before touching |
|-----|----------------------|
| `planning/architecture.md` | Any component, route, or system integration |
| `planning/simulation-runtime-sdk.md` | `simRuntime.js`, `/api/generate`, or any generated sim code |
| `planning/api_contracts.md` | `/api/generate`, `/api/tutor`, or any postMessage schema |
| `planning/tech_stack.md` | AI model usage, library choices, persistence layer |
| `planning/concept.md` | Tutor behavior, system prompt tone, pedagogical design |
| `planning/GAPS.md` | Anything marked as unresolved — do not implement around open questions |
| `planning/work-coordination.md` | Who owns what; do not implement outside your assigned area without checking |

**Planning docs are living documents.** If your implementation diverges from a planning doc — because the doc is wrong, incomplete, or you discovered something new — update the doc alongside the code. Never let the code and docs contradict each other silently.

If you resolve something listed as open in `GAPS.md`, mark it resolved with a date. Do not delete entries.

---

## Tech Stack

- **Framework:** Next.js 16 App Router — no separate backend, all server work in API routes
- **Language:** TypeScript
- **Package manager:** pnpm
- **Styling:** Tailwind CSS 4
- **AI SDK:** Vercel AI SDK (`ai` + `@ai-sdk/google`)
- **Database:** MongoDB Atlas, direct driver (`mongodb`), no Mongoose
- **Voice:** `@elevenlabs/elevenlabs-js` — STT (Scribe) for student input, TTS (streaming) for tutor output
- **Simulation renderers:** p5.js, JSXGraph, Matter.js, canvas2d (native)

---

## AI Models

Two models, two jobs. Keep role boundaries explicit.

| Model | Route | Use |
|-------|-------|-----|
| `gemma-4-31b-it` | `/api/generate` | Demo/default sim generation pipeline: curriculum agent + verification-spec agent + sim-builder agent |
| `gemini-2.5-flash` | `/api/tutor` | Socratic tutor — both calls of the two-call pattern |

```typescript
import { google } from '@ai-sdk/google'

const genModel   = google('gemma-4-31b-it')
const tutorModel = google('gemini-2.5-flash')
```

### Current Testing Override

For local testing, `/api/generate` may be temporarily run with `gemini-2.5-flash`.
For the demo, sim generation must use `gemma-4-31b-it`.

### Two-Call Tutor Pattern (required, not optional)

Neither model reliably interleaves text and tool calls in a single response. The tutor always runs two sequential calls per turn:

1. **Call 1** — `generateText` with tools, no speech. Fires sim actions (lock, highlight, set_param). May return zero tool calls.
2. **Call 2** — `streamText` with no tools. Speaks the Socratic question grounded in Call 1's staging.

Removing Call 2's tools is what makes text generation reliable (10% text rate with tools → ~100% without).

### ID Drift

Tool parameter schemas for `lock`, `unlock`, `highlight`, `set_param`, and region annotations must be Zod enums built dynamically from the manifest. Strict prompting alone gets only 3/5 exact IDs.

### Key Latency Facts

- Gemma 4 31b-it: 10–20s per call — acceptable for one-shot generation, not for tutor turns
- Gemini 2.5 Flash: ~1.4s median — required for the tutor loop

---

## Simulation Runtime

Generated sim code runs inside a sandboxed iframe. It must never access `window`, `document`, or the DOM directly. All interaction goes through `simRuntime.js` via the SDK interface (`registerParam`, `onUpdate`, `onRender`, `emitEvent`, `registerRegion`).

The postMessage protocol is the only communication channel between the iframe and the parent app. See `planning/api_contracts.md` for the exact event schema.

See `planning/simulation-runtime-sdk.md` for the full SDK contract before writing anything in this layer.

---

## Project Structure

```
src/
  app/
    api/
      generate/route.ts   ← Person A
      tutor/route.ts      ← Person A
    page.tsx              ← Person B
    components/           ← Person B
public/
  simRuntime.js           ← Person A
  test.html               ← Person A (dev test harness, not shipped)
  iframe/                 ← Person A (p5.html, canvas2d.html, jsxgraph.html, matter.html)
lib/
  types.ts                ← shared postMessage + API types, source of truth
  mongodb.ts              ← MongoClient singleton
planning/                 ← docs only, never import from here
spikes/                   ← reference only, proven patterns to port from
```

---

## Dev Commands

```bash
pnpm dev        # start dev server on localhost:3000
pnpm build      # production build
pnpm lint       # eslint
pnpm typecheck  # tsc --noEmit
```

---

## Hard Rules

- Do not use Mongoose — direct `mongodb` driver only
- Do not use Mafs — JSXGraph covers the same domain and works in `new Function()` execution
- Do not add auth — localStorage UUID is sufficient for the demo
- Do not implement anything listed as open in `GAPS.md` without first resolving the gap
- `lib/types.ts` is the single source of truth for postMessage event shapes and API request/response types — never inline these elsewhere
