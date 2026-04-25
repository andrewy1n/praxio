# Work Coordination
### Praxio — LA Hacks 2026

---

## Setup (Do Together First — ~30 min)

1. Scaffold the Next.js app: `npx create-next-app@latest praxio --typescript --app`
2. Agree on and commit `lib/types.ts` — postMessage event schema + API request/response shapes
3. Person A takes `app/api/` and `public/`; Person B takes `app/components/` and `app/page.tsx`

---

## Shared Contract (Define Before Splitting)

**postMessage event schema** (sim → parent):
```ts
type SimEvent =
  | { type: "stateChange"; payload: Record<string, unknown> }
  | { type: "ready"; manifest: SimManifest }
  | { type: "paramChange"; id: string; value: number }
```

**`/api/generate` shape:**
```ts
// POST { concept: string }
// → { code: string; manifest: SimManifest }
```

**`/api/tutor` shape:**
```ts
// POST { manifest: SimManifest; history: Message[]; recentEvents: SimEvent[] }
// → streaming: tool calls then text
```

Person B stubs these responses locally and never blocks on Person A.

---

## Person A — Simulation Engine

**Owns:**
- `app/api/generate/route.ts` — two-pass Gemma pipeline
- `app/api/tutor/route.ts` — two-call Gemini tutor loop
- `public/simRuntime.js` — iframe runtime, SDK enforcement
- `public/test.html` — local test harness (no React needed)

**Build order:**

1. **`simRuntime.js`** — implement the SDK interface (`registerParam`, `onUpdate`, `onRender`, event emission, regions). Test with a hand-written sim pasted directly into `test.html`. No API calls yet.

2. **`/api/generate`** — port the two-pass pipeline from `spikes/gemma-tools-v2/test.ts`. Pass 1: concept → design doc (Gemma 4 31b-it, `generateObject`). Pass 1 must emit `verification.probes` and `verification.invariants` in addition to the Socratic plan. Pass 2: design doc → sim code. Validate output with `validateSimModule()`, then run behavioral verification against the probes/invariants. Test with `curl`.

3. **Generate → iframe loop** — `test.html` calls `/api/generate`, displays the verification report, injects returned code into the iframe only after verification passes, and logs all postMessage events to console. This proves the full generation + runtime contract.

4. **`/api/tutor`** — two-call Gemini 2.5 Flash pattern from `spikes/gemini-tutor/test.ts`. Call 1: tool calls (lock/highlight/etc). Call 2: streamed Socratic question. Feed canned sim events from a test script, print responses.

5. **ElevenLabs TTS** — call their API with tutor text output, play back via `<audio>` element in `test.html`.

**Key findings from spikes to apply:**
- Use strict prompting to enforce exact element IDs — Zod enums optional but effective (spikes/gemma-tools-v2)
- Gemini 2.5 Flash: tool rate 100%, text rate only 10% — two-call pattern is required, not optional
- Gemma 4 31b-it: median latency ~12s; Gemini 2.5 Flash: ~1.4s — tutor turns use Gemini, generation uses Gemma
- Keep retry + jitter for transient 503/429 on Gemma
- Correctness cannot be established by static validation alone — generated sims need behavioral probes and invariant checks before the tutor uses them

**System prompts to write (see GAPS.md):**
- `PASS1_SYSTEM_PROMPT` — concept → design doc
- `PASS2_SYSTEM_PROMPT` — design doc → sim code
- `buildCall1SystemPrompt(manifest, designDoc)` — staging call
- `buildCall2SystemPrompt(manifest, designDoc, appliedToolCalls)` — Socratic question call

**Fallback sims to hand-author (see GAPS.md):**
- Projectile motion (p5)
- Derivatives (jsxgraph)
- Diffusion (canvas2d)

---

## Person B — Shell & UI

**Owns:**
- `app/page.tsx` — top-level layout
- `app/components/SimContainer.tsx` — iframe wrapper + slider UI
- `app/components/TutorPanel.tsx` — chat display + voice input
- `app/components/BranchSidebar.tsx` — workspaces, checkpoints
- `lib/db.ts` + MongoDB schema — workspaces, branches, simEvents
- ElevenLabs STT (student microphone input)

**Build order:**

1. **App scaffold + layout** — three-panel layout (sidebar, sim area, tutor panel). Use hardcoded placeholder content.

2. **`SimContainer`** — iframe wrapper that accepts a `srcDoc` string and wires up `window.addEventListener("message", ...)` to receive SimEvents. Test with a hardcoded sim string.

3. **`TutorPanel`** — chat message list + text input. Wire up to `/api/tutor` stub. Display streamed text responses.

4. **ElevenLabs STT** — mic button, Scribe API call, transcript fed into tutor panel.

5. **Concept input flow** — the entry point: text or voice input that triggers `/api/generate` and loads the returned sim into `SimContainer`.

6. **`BranchSidebar` + MongoDB** — workspace list, checkpoint save/restore. Lower priority; skip if time-constrained.

**Stubbing strategy:**
```ts
// stubs/api.ts
export const generateSim = async (concept: string) => ({
  code: HARDCODED_PROJECTILE_SIM,
  manifest: HARDCODED_MANIFEST,
})

export const tutorTurn = async (...) => ({
  toolCalls: [],
  text: "What do you think happens to range as you increase the angle?",
})
```
Swap stubs for real API calls once Person A's routes are ready.

---

## Integration Points (Sync Checkpoints)

| When | What to verify |
|------|---------------|
| After Person A finishes simRuntime + test harness | Person B drops `test.html` iframe pattern into `SimContainer`; confirm postMessage events arrive |
| After Person A finishes `/api/generate` | Person B swaps generate stub for real call; confirm sim renders |
| After Person A finishes `/api/tutor` | Person B swaps tutor stub for real call; confirm tool calls apply to sim |
| After Person B finishes STT | Person A tests full voice → generate → tutor loop in `test.html` |

---

## Implementation Order — Workspace Visibility + Resume

Goal: ship a minimal, reliable `Recent workspaces` flow for the anonymous `sessionId`
model before adding deeper branch UX.

### Phase 1 (Backend contracts first)

**Owner: Person A**

1. Add `GET /api/workspaces` list endpoint (session-scoped, sorted by `lastActiveAt desc`).
2. Add `GET /api/workspaces/:workspaceId` resume endpoint (session guard, include completion state when present).
3. Add `PATCH /api/workspaces/:workspaceId` progress metadata endpoint (`status`, `lastActiveAt`, `completedAt`, `completionSummary`).
4. Ensure write paths update `lastActiveAt` during tutor turns and mark completion metadata when session completes.

Definition of done:
- Endpoints return shapes defined in `planning/api_contracts.md`.
- Cross-session reads are rejected.

### Phase 2 (Landing UX + resume entry)

**Owner: Person B**

1. Add `RecentWorkspacesPanel` to Landing under concept input.
2. Render fields: concept, relative time, status badge; group into `Today` and `Earlier`.
3. Wire `Resume` action to `/workspace/[workspaceId]`.
4. Add empty state (`No recent workspaces yet`) and loading/error states.

Definition of done:
- Fresh session with no rows renders empty state.
- Existing session rows are visible and resumable.

### Phase 3 (Completion-aware re-entry)

**Owners: A + B**

1. On workspace load, branch by `status`:
   - `in_progress` → continue normal Socratic loop.
   - `completed` → open completion state (synthesis + transfer question + completion actions).
2. Add `Replay last step` entry path for completed sessions.
3. Keep branch/checkpoint deep UX out-of-scope for this slice.

Definition of done:
- Completed sessions do not restart from step 1 by default.
- Replay path is explicit and user-driven.

### Suggested build sequence

`Phase 1` → `Phase 2` → `Phase 3` (strict order to avoid frontend stubbing churn).

---

## Risk Register

| Risk | Owner | Mitigation |
|------|-------|-----------|
| Generated sim code fails `validateSimModule` | A | Fallback registry (3 hand-authored sims) |
| Generated sim code is runnable but conceptually wrong | A | Behavioral verification probes/invariants; retry Pass 2 with failed checks; fallback to pre-verified templates |
| Tutor tool call IDs don't match sim manifest | A | Strict prompting + Zod enum enforcement |
| Gemma latency too high for demo (~12s) | A | Cache generated sims; show loading state |
| iframe postMessage schema drifts | Both | `lib/types.ts` is source of truth; never inline event shapes |
| Voice STT latency disrupts demo flow | B | Text input always available as fallback |
