# LA Hacks 2026 — Project Concept

## Product Name

**Praxio**

---

## The Problem

When a student encounters a concept they genuinely don't understand — not a topic they want to browse, but a specific thing that isn't clicking — their options are poor. They can read a static textbook explanation, watch a passive video, or ask an AI that responds with more text. None of these force active engagement with the concept. None of them let the student *discover* the answer themselves.

The research is clear: the deepest learning happens when students construct understanding through exploration and experience, not passive reception. The best human tutors don't explain — they build an experience and guide you through discovering the answer yourself. That approach has never been accessible at scale.

---

## The Insight

Any concept that can be understood can be *modeled*. A model you can manipulate with your hands — changing variables, breaking assumptions, watching consequences propagate — produces a qualitatively different kind of understanding than a model described in words.

The missing primitive in education technology is not a better explanation. It is a **bespoke, interactive simulation generated on demand for exactly the concept a student is stuck on**, paired with an AI that refuses to explain and instead guides discovery through the simulation itself.

Critically: the simulation is not just a student sandbox. It is a **shared instrument** — both the student and the AI tutor have hands on it, with different affordances. The student manipulates; the AI stages. The tutor can lock controls, highlight variables, introduce perturbations, and rewind state — shaping what the student sees and can touch in real time, in service of guided discovery.

The hard technical risk is truth. A generated simulation that renders correctly can still encode the wrong physics, math, or biology, and a tutor that confidently guides through a false model is worse than a static explanation. Praxio therefore treats generated simulations as artifacts that must be **behaviorally verified** before they become teaching instruments. The agent must not merely produce runnable code; it must produce executable claims about the model, then prove the simulation obeys those claims through deterministic probes and domain invariants.

---

## What We're Building

A tool for students who are stuck on something specific.

The student inputs a concept they don't understand — by typing or speaking. The system generates a live, interactive simulation of that concept — a manipulable toy universe that physically embodies the idea. The student can touch it, break it, explore it. An AI tutor then guides the student through that simulation Socratically: asking questions out loud, pointing at specific variables, prompting predictions, and responding to what the student actually does rather than what they say.

The AI never directly explains the concept. It guides the student to the explanation themselves.

### The Core Loop

```
Student names a concept (voice or text)
        ↓
A design doc appears with equations, invariants, and probe cases
        ↓
A bespoke interactive simulation is generated and behaviorally verified
        ↓
AI tutor stages the initial scene via function calls
(locks irrelevant controls, highlights key variables)
        ↓
AI speaks a Socratic opening question via ElevenLabs TTS
        ↓
Student manipulates, predicts, discovers
        ↓
Simulation streams interaction events to the AI (what changed, how fast, what state)
        ↓
AI responds to their actions — calls sim commands, speaks a follow-up question, or both
        ↓
Student arrives at understanding themselves
```

---

## The Dual-Interface Architecture

The simulation is a shared instrument with two distinct interfaces operating on the same live state.

### Human Interface

Standard interactive controls — sliders, draggable objects, toggleable variables. The student manipulates the simulation directly and sees consequences propagate in real time. Voice input via ElevenLabs STT lets the student respond to the tutor's questions without breaking their hands away from the sim.

For the demo, the human interface must include three commitment-first interactions:

- **Prediction sketching**: before launching or changing the scene, the student draws their expected trajectory/path directly over the simulation. The actual path overlays afterward so the tutor can question the gap between prediction and observation.
- **Numerical hypothesis input**: the student can enter a concrete estimate such as "range will be 45m" before manipulating. The tutor can branch based on whether the estimate was close, high, or low.
- **Click-to-query**: the student can click a meaningful part of the simulation, such as the apex, landing point, or launch point, to make that region the focus of the next tutor question.

### Agent Interface

The AI tutor drives the simulation through **native function calls** — not parsed text commands. The tutor runs a two-call pattern per turn: Call 1 decides which sim actions to fire (returns tool calls, no speech), Call 2 speaks the Socratic move grounded in what Call 1 just staged. This pattern is forced by a finding from our spike work: neither Gemma 4 nor Gemini 2.5 Flash reliably interleave text and tool calls in a single streamed response, and forcing both in one call collapses text-generation reliability to 10–40%. Splitting the turn makes ordering deterministic (stage → speak, matching the demo script) and recovers text reliability in Call 2 by removing tool competition.


| Function                       | What It Does                                                 |
| ------------------------------ | ------------------------------------------------------------ |
| `set_param(name, value)`       | Moves a slider or sets a variable programmatically           |
| `lock(element_id)`             | Removes a control from student reach temporarily             |
| `unlock(element_id)`           | Restores a previously locked control                         |
| `highlight(element_id)`        | Applies visual emphasis to a **parameter control** (glow, border) — params only, not regions |
| `add_annotation(region, text)` | Overlays a label or question prompt pinned to a named region |
| `clear_annotations()`          | Removes all active annotations                               |
| `checkpoint()` / `restore(id)` | Saves and rewinds sim state for "what if" branching          |
| `trigger_event(type)`          | Introduces a perturbation (e.g., a third planet appears)     |
| `set_scene(config)`            | Resets the initial condition to a new pedagogical setup      |
| `pause()`                      | Freezes the animation loop; render continues so the frozen frame stays visible |
| `play()`                       | Resumes the animation loop from current state                |


### The Observation Loop

The agent receives a structured event stream from the simulation — not just chat messages. Every student interaction produces a structured event:

```json
{
  "event": "param_changed",
  "param": "launch_angle",
  "from": 30,
  "to": 60,
  "sim_state": {
    "range_m": 34.3,
    "max_height_m": 15.3
  },
  "timestamp": 1713900000000
}
```

Student predictions and spatial focus selections are also part of the event stream:

```json
{
  "event": "hypothesis_submitted",
  "payload": {
    "metric": "range_m",
    "value": 45,
    "unit": "m"
  },
  "timestamp": 1713900000000
}
```

This grounds the Socratic loop in real interaction data. The AI responds to what the student **does**, predicts, and chooses to inspect — not just what they say. The agent's next move is always one of: a spoken question, a function call, or both.

### The Truth-Grounding Loop

Praxio does not trust generated code because it compiles. Before the student sees a generated simulation, the backend runs a behavioral verification pass:

```
Design doc declares equations, invariants, and probe cases
        ↓
Generated sim code runs in a headless verification runtime
        ↓
Verifier executes deterministic probes against the sim
        ↓
Observed behavior is compared to expected relationships
        ↓
Only verified sims become tutor-controllable learning environments
```

For projectile motion, verification can check that 30° and 60° produce approximately equal range, 45° is near the maximum range under equal launch/landing height, increasing gravity decreases range, and doubling initial velocity roughly quadruples range. These are not UI smoke tests; they are executable behavioral claims about the concept. If verification fails, the sim-builder agent retries with the failed invariant as feedback, and repeated failure escalates to a pre-verified template.

### System Architecture

```
Student voice/text
        ↓
ElevenLabs STT (voice path)
        ↓
┌────────────────────────────────────────────┐
│         Google AI Studio (@ai-sdk/google)   │
│                                             │
│  Curriculum Agent:       Gemma 4 31B-it     │
│           concept → design doc core JSON    │
│  Verification Spec Agent: Gemma 4 31B-it    │
│           design doc core → probes/invariants│
│  Sim Builder Agent:      Gemma 4 31B-it     │
│           full design doc → sim JS module   │
│  Verify:  deterministic probes + invariants │
│  Tutor:   Gemini 2.5 Flash, two-call turn   │
│           Call 1: tool calls (stage scene)  │
│           Call 2: text (Socratic question)  │
└──────────────────────────┬─────────────────┘
                           │
           ┌───────────────┴───────────────┐
           │         iframe sandbox         │
           │        SimRuntime.js           │
           │  postMessage agent bridge      │
           │  p5 / canvas2d / JSXGraph / Matter │
           └───────────┬───────────────────┘
                       │
          ┌────────────┴────────────┐
          │     Human Interface      │
          │  sliders · drag · tap    │
          └──────────────────────────┘
                       │
           events stream up to tutor
           tutor function calls stream down
                       │
           ┌───────────┴───────────┐
           │    ElevenLabs TTS      │
           │  tutor speaks to student│
           └────────────────────────┘
                       │
           ┌───────────┴───────────┐
           │     MongoDB Atlas      │
           │  workspaces · branches │
           │  checkpoints · chat    │
           └────────────────────────┘
```

---

## Tech Stack

### AI — Gemma 4 31B-it + Gemini 2.5 Flash (Google AI Studio)

All AI calls go through the Vercel AI SDK (`ai` + `@ai-sdk/google`) from Next.js API routes. Models are split by role based on measured behavior from our spike work:

- **Curriculum agent** (concept → design doc core): **Gemma 4 31B-it**. Structured JSON output via `generateObject`.
- **Verification-spec agent** (design doc core → probes/invariants): **Gemma 4 31B-it**. Structured JSON output via `generateObject`.
- **Sim-builder agent** (full design doc → sim code): **Gemma 4 31B-it**. Coding output via `generateText`.
- **Socratic tutor**: **Gemini 2.5 Flash**, two-call pattern per turn. Gemma was disqualified for this role by 10–20s end-to-end latency and a 40% text-generation rate when tools were also requested; Gemini 2.5 Flash runs at ~1.4s median and, split into a tools-call and a text-call, produces speech at the required reliability. Keeping Gemma for the generation pipeline preserves the "powered by Gemma 4" story for the novel part of the product (on-demand simulation generation).

### Voice — ElevenLabs (bidirectional)

- **STT**: ElevenLabs Scribe transcribes student speech in real time. Keyboard input always available as fallback.
- **TTS**: Streaming TTS for the tutor. Playback begins as soon as Gemma starts streaming — response latency stays under 2 seconds on the critical path.
- A microphone toggle in the UI makes voice opt-in rather than default, keeping keyboard-only use clean.

### Persistence — MongoDB Atlas

Three collections:

```
workspaces   { concept, subject, designDoc, renderer, createdAt }
branches     { workspaceId, name, checkpoints[], conversationHistory[] }
simEvents    { branchId, event, payload, timestamp }
```

A branch document holds its full checkpoint stack and conversation history inline to avoid joins under demo conditions. Session identity is a UUID in localStorage — no auth required for the demo.

### Simulation Runtime

- **Renderer**: p5.js for physics and motion sims; JSXGraph for math/calculus sims; Matter.js for rigid body physics; canvas2d as fallback. The curriculum agent selects the renderer based on concept domain.
- **Execution**: Generated sim modules run inside an iframe sandbox via `new Function('runtime', code)`. No files written to disk.
- **Generation**: multi-agent pipeline (curriculum-agent, verification-spec-agent, sim-builder-agent) with static validation and behavioral verification before iframe load. Repeated static or behavioral failures escalate to a pre-verified template.
- **Behavioral verification**: generated simulations must satisfy the design doc's probe cases and invariants before the tutor can use them. Static validation proves the code is safe enough to run; behavioral verification proves the model is plausible enough to teach from.

### UI Prototyping — Figma Make

The workspace UI (three-panel layout: branch sidebar, sim viewport + params bar, tutor panel with voice indicator) is prototyped in Figma Make before implementation. The Figma Make process — draft, iteration, and handoff — is documented for the Devpost submission.

---

## What Makes This Different

**From existing AI tutors** (including the current state of the art): They generate explanations. We generate experiences, then verify those experiences against executable domain claims before using them to teach. The student is active throughout, not a passive receiver of information.

**From existing educational simulations** (PhET, Desmos, GeoGebra): They are pre-built for fixed concepts and require a teacher to provide context and questioning. Ours are generated on demand for any concept, with the Socratic guidance built in. Crucially, in PhET the AI has no hands — it can only talk. Here, the AI reshapes the simulation itself through function calls.

**From video-based learning** (Khan Academy, 3Blue1Brown): Watching someone else understand something is fundamentally different from understanding it yourself. Our simulations are not demonstrations — they are sandboxes.

**The core novelty**: the AI tutor is not a chat layer bolted onto a simulation. It is a co-director with a live function-calling API into the simulation environment — staging scenes, gating controls, and introducing perturbations in real time based on what the student actually does. The generated environment is also verified as an executable model before the tutor relies on it. No one has built this at the simulation-generation layer.

**From generic agent tooling**: Most agent verification checks whether an output is well-formed: tests pass, JSON parses, commands execute. Praxio verifies whether a generated interactive tool behaves like the real concept it claims to model. That makes the agent more capable in a measurable way: it can generate, inspect, repair, and then act inside a tool whose behavior is constrained by domain truth.

---

## Target Subjects

Three subjects anchor the demo, each with a pre-validated simulation:


| Subject | Demo Concept                                                   | Renderer |
| ------- | -------------------------------------------------------------- | -------- |
| Physics | Projectile motion — why 45° maximizes range                    | p5.js    |
| Math    | Derivatives — what the slope of a tangent actually means       | JSXGraph |
| Biology | Enzyme kinetics / membrane diffusion — concentration gradients | canvas2d |


The generative pipeline is demonstrated live on a fourth concept named by the judge — using one of the three above as a safety net if generation fails.

---

## The Target User

A university or high school student, 30 minutes before a study session or office hours visit, stuck on a concept that hasn't clicked despite reading, watching, and asking. They know what they don't understand. They just need a better way in.

---

## The Demo Moment

A judge opens the app. They speak into the mic: *"I don't understand why launch angle affects projectile range the way it does."*

ElevenLabs STT transcribes it. Gemma 4 curriculum-agent runs. Verification-spec-agent runs. Sim-builder-agent runs. A live simulation appears — a cannon on a flat plane, a trajectory arc, three labeled sliders: **Launch Angle**, **Initial Velocity**, **Gravity**.

Before it appears, Praxio shows a verification card: **30° and 60° range symmetry — passed. 45° near-max range — passed. Higher gravity lowers range — passed. Doubling velocity quadruples range — passed.** The judge sees that the agent did not merely generate a pretty animation; it checked the model's behavior against physics invariants.

Before any spoken word, the tutor calls `lock("gravity")` and `highlight("launch_angle")` — gravity disappears from the student's controls, launch angle glows in the sidebar. Then, through the speakers: *"Before you calculate anything — if you increase the angle from 30 to 60 degrees, what do you predict happens to the range?"*

Before launching, the judge sketches the path they expect and types a range estimate: *"45m."* The sim records both commitments. Then the judge drags the angle slider. The arc climbs higher, but lands *shorter* than expected. The sim emits `{ "event": "param_changed", "param": "launch_angle", "from": 30, "to": 60, "sim_state": { "range_m": 34.3 } }` plus the prior prediction context. The tutor sees the gap between expected and actual behavior.

The judge clicks the apex. The tutor calls `add_annotation("apex", "What are the velocity components here?")` — a label pins to the arc's peak. Then: *"What's happening to the horizontal component as you tilt further up?"*

The judge reasons it through. The tutor calls `set_param("launch_angle", 45)` — the sim snaps to 45° and range visibly maximizes. `add_annotation("landing", "Peak range. Why 45?")` appears at the landing point.

The judge speaks: *"Because at 45 the horizontal and vertical components are balanced — you're splitting velocity optimally."*

The tutor unlocks gravity: *"Now cut gravity in half. Same angle, same velocity — what changes?"*

They didn't solve the formula. They understood it. The numerical answer follows naturally.

That is the product.

---

