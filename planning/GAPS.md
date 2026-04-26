# Known Gaps in Planning
## Praxio — LA Hacks 2026

As of 2026-04-24, after adding generation prompts, tutor prompts, and the first behavioral verifier. This document tracks remaining work needed before MVP is buildable.

---

## Critical Path Gaps

### 1. System Prompts Need Eval Coverage
**Status:** Implemented, not yet evaluated broadly  
**Blocker:** Medium — all AI behavior depends on these staying reliable across concepts

Implemented in `src/lib/prompts.ts`:

- `CURRICULUM_SYSTEM_PROMPT` — concept → design doc core.
- `VERIFICATION_SPEC_SYSTEM_PROMPT` — design doc core → verification probes/invariants.
- `buildSimBuilderPrompt()` — full design doc → sandbox-safe sim code, including renderer cheatsheets.
- `buildCall1SystemPrompt()` — staging/tool decision prompt.
- `buildCall2SystemPrompt()` — Socratic speech prompt.

**Work:** Run offline evals against representative concepts and refine prompt failures. Track schema failures, ID drift, invalid sim code, missing metrics, and non-Socratic speech.

---

### 2. Template Fallback Registry
**Status:** Partially implemented — `physics` and `biology` only  
**Blocker:** Low for two-domain demo — `math`, `chemistry`, and `general` still have no preset

Implemented in [`src/lib/templateRegistry.ts`](../src/lib/templateRegistry.ts) and wired from [`src/lib/generationPipeline.ts`](../src/lib/generationPipeline.ts): on exhausted static validation or behavioral verification, load `public/presets/<id>/design-doc.json` + `sim.js`, run `validateDesignDocConsistency` and `verifySimBehavior`, return `fromTemplate: true` with the preset design doc.

Shipped presets:

- **Projectile motion** (`physics` → `projectile-motion`, p5)
- **Logistic population** (`biology` → `population-growth`, canvas2d)

Still missing (no folder under `public/presets/` yet):

- **Derivatives** (jsxgraph): function graph, draggable point, tangent, slope readout
- **Diffusion** (canvas2d): two chambers, gradient, particles, flux arrow

**Work:** Add `derivatives` and `diffusion` preset pairs and extend `DOMAIN_TO_PRESET` for `math` / `chemistry` (or map `general` to a safe default).

---

### 2a. Behavioral Verification Harness Needs Hardening
**Status:** Implemented, needs runtime-drift and domain coverage checks  
**Blocker:** Medium — Cognition alignment depends on proving generated sims are not just runnable, but conceptually plausible

Static validation catches sandbox and SDK violations, but it cannot catch false physics/math/biology. `src/lib/verification.ts` now runs deterministic probe cases against a headless runtime adapter and compares observed metrics to invariant checks from `designDoc.verification`.

Minimum viable scope:
- Projectile motion: range symmetry at 30°/60°, 45° near-max range, gravity monotonicity, velocity scaling
- Derivatives: tangent slope near finite-difference slope at probe points, slope sign across increasing/decreasing regions
- Diffusion: concentration difference decreases over time, flux direction follows gradient

Remaining risks:
- The headless adapter can drift from `public/simRuntime.js`.
- Metric extraction depends on generated sims emitting the expected numeric payload keys.
- Demo-domain coverage still needs real preset/generated-sim runs.

**Work:** Verify presets and generated sims for projectile motion, derivatives, diffusion, and population growth. Extract shared runtime behavior if verifier/runtime drift causes false positives or false negatives.

---

### 3. Tool-Result Loop for Checkpoints
**Status:** RESOLVED — Option A (tool-result roundtrip with opaque string IDs)
**Blocker:** None

**Decision:** Client applies `checkpoint()`, waits for `CHECKPOINT_SAVED { id: string }` from iframe, splices the ID back into `appliedToolCalls` as `result: { id }` before Call 2. IDs are opaque strings (e.g. `ckpt_a4f2`) so the model cannot do arithmetic on them — it can only restore to IDs it has literally seen in its context.

**Specified in:** `api_contracts.md` — tool definitions, postMessage protocol, client-side application logic, MongoDB `Checkpoint` type.

---

### 3a. Design-Doc Consistency Validation
**Status:** Implemented  
**Blocker:** None

[`src/lib/designDocConsistency.ts`](../src/lib/designDocConsistency.ts) implements cross-reference checks (params, regions, events, staging, Socratic plan, probes, invariants). [`src/lib/generationPipeline.ts`](../src/lib/generationPipeline.ts) runs it immediately after curriculum + verification-spec generation; failures return HTTP 422 with `phase: 'designDocConsistency'` and `consistencyErrors`.

**Work:** Extend checks only if new `DesignDoc` fields are added or eval finds holes.

---

## Product-Surface Gaps

### 4. No UI Specification
**Status:** Concept sketch only ("three-panel layout")  
**Blocker:** Medium — implementation is vague without wireframes

Missing:
- Component inventory (SimContainer, TutorPanel, BranchSidebar exact layout, controls)
- Empty states (pre-generation, generation-in-progress, error states, session expired)
- Error states (generation failure, tutor latency, TTS failure, iframe crash)
- Branch/workspace navigation UI
- Microphone toggle and voice indicator states
- Checkpoint/restore UI (how does the student see/select branches?)

**Work:** Sketch in Figma Make or create simple HTML mockups in `planning/design/`. Three panels is a start; fill in the details.

---

### 5. No Build Plan / Time Budget
**Status:** Not written yet  
**Blocker:** High — need to know what ships at 36h

Scope creep surface area:
- Generation pipeline (curriculum agent, verification-spec agent, sim-builder agent, validation, fallback) — ~6h
- Socratic tutor (Call 1, Call 2, system prompts, tool application) — ~8h
- Simulation runtime SDK (iframe, postMessage, renderers, checkpoints) — ~8h
- Voice layer (STT, TTS, microphone toggle, streaming) — ~4h
- MongoDB persistence (workspaces, branches, events, TTL) — ~3h
- UI components (three panels, sliders, chat, branch sidebar) — ~6h
- Testing / polish / demo rehearsal — ~1h

**Total:** ~36h (very tight). No buffer for surprises. Need ruthless cut decisions upfront.

**Work:** Create a phase breakdown, assign ownership, identify the MVP-critical path vs nice-to-have features (e.g., checkpoint/restore is nice; it's not in the concept.md demo moment).

---

### 6. Agent Loop Orchestration
**Status:** RESOLVED  
**Blocker:** None

**Decision:** Tutor fires on `STUDENT_UTTERANCE` (always) or `SIM_EVENT` where the event name is in `designDoc.events` (the allowlist). Tutor never fires on `PARAM_CHANGED` — param state is read from the manifest snapshot at call time.

This kills slider-spam entirely while preserving the concept.md demo beat (`projectile_landed` → tutor reacts). The `designDoc.events` list is the de facto trigger allowlist; events not declared there are ignored by the tutor loop.

**Specified in:** `api_contracts.md`.

---

### 7. Initial Staging Dispatch
**Status:** RESOLVED — client applies initial staging after `MANIFEST`  
**Blocker:** None

From the concept.md demo script:
```
Before any spoken word, the tutor calls lock("gravity") and highlight("launch_angle")
```

**Decision:** Option A. Client applies `designDoc.initial_staging` immediately after iframe sends `MANIFEST`, before the opening tutor question. This gives the fastest first impression and avoids waiting for a tutor staging call just to apply known initial locks/highlights.

**Specified in:** `architecture.md` simulation generation flow.

---

### 8. Conversation/Event History Grows Unbounded
**Status:** Not specified  
**Blocker:** Low — affects long sessions, not MVP

If a student has a 30-minute session, `messages` and `pendingEvents` grow linearly. Each `/api/tutor` call sends the full history to the model. This is expensive and slow.

**Missing:**
- Truncation policy (keep last N turns? last 2h of events?)
- Summary strategy (condense old turns into a summary, or discard?)
- What gets kept in MongoDB vs what's ephemeral?

**Work:** Defer to post-MVP unless you notice latency creep. For the demo, assume <5 min sessions, so this is not a blocker.

---

### 9. Multi-Workspace Navigation UI
**Status:** Partially specified  
**Blocker:** Low — affects post-session flow

The architecture says localStorage UUID is the session identity, and MongoDB stores multiple workspaces per session. But there's no spec for:

- How does the student see their workspace history?
- Can they resume an old workspace?
- Can they branch off a checkpoint as a new workspace?

**Current spec:** "Branch Sidebar lists workspaces and named branches". That's the whole UI spec.

**Work:** Defer to post-MVP. For the demo, assume single-workspace-per-session, or keep a simple list.

---

### 10. Evaluation / Testing Strategy
**Status:** Missing  
**Blocker:** Medium — how do you know it works before demo day?

Missing:
- **Offline eval:** 20 hand-picked concepts, run generation offline, check: do all pass validation? Do the params make sense? Do the sims run?
- **Behavioral eval:** for supported demo domains, do generated sims satisfy the design doc's probe cases and invariants?
- **Smoke tests:** does the full happy path work end-to-end? (concept → design doc → sim code → iframe load → tutor call → speech output)
- **Spike test results:** v2 and v3 spikes proved Gemini tool calling works, but not that the full two-call turn works in the real app.
- **Demo script walkthrough:** can you smoothly run the demo moment (projectile motion with locked gravity, highlighted angle, predicted range question)?

**Work:** Create a test harness:
1. List of 5-10 test concepts with expected outputs (design doc, sim code)
2. Offline validation script that runs curriculum + verification-spec + sim-builder stages, checks Zod schema + code validation
3. End-to-end smoke test that spins up a local instance, runs a concept, checks tutor call succeeds
4. Behavioral verification harness that runs generated sims against invariant probes before iframe load
5. Manual checklist: can you demo projectile, derivatives, diffusion end-to-end in <30s each?

---

## Design Debt (Lower Priority)

### 11. No ID Uniqueness in Sim Manifests
If two params share a name substring (e.g., `angle` and `launch_angle`), ID drift and Zod enum matching could collide. The manifest schema should enforce uniqueness, but currently doesn't.

**Work:** Covered for generated design docs by gap 3a. Runtime manifests should also enforce uniqueness before constructing tutor tool enums.

### 12. Regions Without Coordinates Until Frame 1
`registerRegion(name, { getPosition: () => ... })` can't return a position until the first `onRender` fires. But annotation tools might be called before that. Undefined behavior.

**Work:** Document the guarantee that annotations only appear after sim has rendered once, or null-check coordinates on annotation render.

**Resolved 2026-04-24:** `registerRegion` now requires `getPosition`; parent sends `TRACK_REGIONS` only while overlays are active; iframe streams throttled `REGION_POSITIONS`. Test overlay uses a temporary fallback until first valid coordinate arrives, then pins highlights/annotations to iframe-local CSS pixels.

### 13. No Conflict Policy for Concurrent Edits
Student drags a slider while the tutor issues `set_param` on the same slider. What wins?

**Work:** Spec a last-write-wins policy, or lock params during agent turns.

---

## Summary

**Blockers preventing build:**
1. Additional template presets (derivatives, diffusion) and domain mapping for `math` / `chemistry` / `general` — ~2h
2. UI spec / mockups — ~2h
3. Build/cut plan — ~1h

**Blockers preventing confident demo:**
5. Prompt eval coverage — ~2h to run representative concepts and refine failures
6. Behavioral verification hardening — ~2h to verify demo domains and check runtime drift
7. Offline eval harness — ~2h

**Can defer to post-MVP:**
8. Checkpoint/workspace navigation
9. Session history truncation
10. Coordinate edge cases
11. Concurrent edit conflicts

**Estimated remaining planning/architecture work to MVP:** 6–9h of focused writing, validation, and eval. Most remaining risk is reliability, not missing concept architecture.

