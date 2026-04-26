# Simulation Runtime SDK
### Praxio — LA Hacks 2026

---

## Overview

The Simulation Runtime SDK is the foundational layer that makes LLM-generated simulations reliable, agentable, and pedagogically controllable. Rather than generating arbitrary code, the LLM authors modules that run *inside* this constrained runtime. The runtime owns the UI, the agent bridge, the event stream, and the iframe sandbox — the generated sim only owns the domain logic.

**The core guarantee**: any sim module that correctly uses this SDK automatically gets sliders, agent control, event routing, checkpoint/restore, annotation support, and behavioral verification hooks for free.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Parent Frame (React)                  │
│                                                          │
│   ┌─────────────────────┐     ┌───────────────────────┐ │
│   │    SimContainer     │     │     Agent Bridge      │ │
│   │                     │     │                       │ │
│   │  Dynamic slider UI  │     │  agentAPI.lock()      │ │
│   │  (built from        │     │  agentAPI.set_param() │ │
│   │   manifest)         │     │  agentAPI.highlight() │ │
│   │                     │     │  agentAPI.annotate()  │ │
│   └────────┬────────────┘     └──────────┬────────────┘ │
│            │                             │               │
│            └──────────── postMessage ────┘               │
│                              │                           │
└──────────────────────────────┼───────────────────────────┘
                               │
               ┌───────────────▼──────────────┐
               │          iframe               │
               │                              │
               │   simRuntime.js              │
               │   + generated sim module     │
               │                              │
               │   Isolated execution         │
               │   No DOM access to parent    │
               └──────────────────────────────┘

postMessage protocol (parent → iframe):
  { type: 'TRACK_REGIONS', enabled: true }
  { type: 'AGENT_CMD',   action: 'lock',      target: 'gravity' }
  { type: 'AGENT_CMD',   action: 'set_param', target: 'launch_angle', value: 45 }
  { type: 'AGENT_CMD',   action: 'highlight', target: 'launch_angle' }
  { type: 'AGENT_CMD',   action: 'annotate',  region: 'apex', text: '...' }
  { type: 'AGENT_CMD',   action: 'checkpoint' }
  { type: 'AGENT_CMD',   action: 'restore',   index: 0 }
  { type: 'AGENT_CMD',   action: 'pause' }
  { type: 'AGENT_CMD',   action: 'play' }
  { type: 'AGENT_CMD',   action: 'launch' }   ← episodic sims only; triggers onLaunch callback
  { type: 'AGENT_CMD',   action: 'reset' }    ← episodic sims only; triggers onReset callback

postMessage protocol (iframe → parent):
  { type: 'MANIFEST',    params: [...], regions: [...], events: [...], animates: true, episodic: false }
  { type: 'REGION_POSITIONS', regions: { apex: { x: 240, y: 120 } } }
  { type: 'SIM_EVENT',   event: 'projectile_landed', payload: {...} }
  { type: 'PARAM_CHANGED', param: 'launch_angle', from: 30, to: 60, sim_state: {...} }
  { type: 'SIM_PAUSED' }
  { type: 'SIM_RESUMED' }
  { type: 'SIM_PHASE',   phase: 'idle' | 'active' | 'done' }  ← episodic sims only
```

The parent frame also owns a simulation overlay for student interactions that do not require generated sim code:

- Prediction sketching: captures freehand points in iframe-local CSS pixels before observation.
- Numerical hypothesis input: captures a concrete metric/value/unit prediction before manipulation.
- Click-to-query: maps a click to the nearest registered region using `REGION_POSITIONS`.

These overlay interactions are appended to the tutor's `pendingEvents` stream as app-level observations. They are not sent into the iframe and they do not expand the generated sim SDK surface.

---

## Core API

### Built-in primitives (`runtime.physics`, `runtime.math`)

The iframe loads [`public/runtime-primitives/physics.js`](../public/runtime-primitives/physics.js) and [`public/runtime-primitives/math.js`](../public/runtime-primitives/math.js) after [mathjs](https://mathjs.org/), then [`public/simRuntime.js`](../public/simRuntime.js) exposes them on the same `runtime` object as the rest of the SDK.

- **`runtime.physics`** — closed-form helpers (no hand-rolled Euler integration for covered cases). Includes:
  - `projectile(speed_mps, angle_deg, g_mps2)` — `positionAt(t)` with `y_m = 0` at launch, `y_m > 0` upward; `range`, `flightTime`, `peak`, `didLand(t)`.
  - `shm`, `exponentialDecay`, `elasticCollision1D`, `logisticGrowth` — see source for signatures.
- **`runtime.math`** — thin facade over mathjs: `derivative`, `integral`, `evaluate`, `taylorCoefficients`, `complex`.

The curriculum agent may set `primitive` on the design doc (e.g. `physics.projectile`); the sim-builder agent is instructed to call these instead of re-deriving unstable numerics. The headless behavioral verifier injects the same APIs so generated code verifies under the same surface as the iframe.

### `runtime.registerParam(name, options)`

Declares a manipulable variable. This is the most important primitive. Every call to `registerParam` automatically:

- Generates a labeled slider in the parent UI
- Registers the param in the agent bridge (making it lockable, settable, highlightable)
- Adds the param to the manifest sent on load
- Subscribes the param to agent `set_param` commands

```javascript
const angle = runtime.registerParam('launch_angle', {
  min: 0,
  max: 90,
  default: 30,
  label: 'Launch Angle',
  unit: '°',
  step: 1           // optional — defaults to continuous
})

// Returns a reactive getter. Call it in update/render to read current value.
const currentAngle = angle()  // → 30 (or whatever agent/student set it to)
```

**Options**

| Field | Type | Required | Description |
|---|---|---|---|
| `min` | number | ✓ | Minimum slider value |
| `max` | number | ✓ | Maximum slider value |
| `default` | number | ✓ | Initial value on load |
| `label` | string | ✓ | Human-readable slider label |
| `unit` | string | — | Displayed next to value (e.g. `'m/s'`) |
| `step` | number | — | Discrete step size. Omit for continuous. |

---

### `runtime.onUpdate(callback)`

Registers the physics/logic tick. Called on every animation frame with `dt` in seconds. The runtime stops calling this callback while paused — generated sim code does not need to check pause state itself. `onRender` continues to be called while paused so the frozen frame remains visible.

```javascript
runtime.onUpdate((dt) => {
  state.vx = velocity() * Math.cos(angle() * Math.PI / 180)
  state.vy = velocity() * Math.sin(angle() * Math.PI / 180)
  state.x += state.vx * dt
  state.y += state.vy * dt - 0.5 * gravity() * dt * dt

  if (state.y <= 0 && state.t > 0) {
    runtime.emit('projectile_landed', {
      range_m: state.x,
      max_height_m: state.maxY,
      time_of_flight_s: state.t
    })
  }
})
```

---

### `runtime.onRender(callback)`

Registers the draw loop. The runtime passes the appropriate rendering context based on the renderer declared in the design document.

```javascript
// p5.js variant — ctx is a p5 instance
runtime.onRender((p) => {
  p.background(255)
  p.ellipse(state.x * scale, height - state.y * scale, 10, 10)
})

// Canvas 2D variant — ctx is a CanvasRenderingContext2D
runtime.onRender((ctx) => {
  ctx.clearRect(0, 0, width, height)
  ctx.beginPath()
  ctx.arc(state.x * scale, height - state.y * scale, 5, 0, Math.PI * 2)
  ctx.fill()
})
```

The sim code calls `runtime.onRender(fn)` identically regardless of renderer. The runtime injects the right context type.

---

### `runtime.emit(eventType, payload)`

Emits a structured event to the parent frame. The agent receives these events as part of its observation loop and uses them to decide its next action.

```javascript
runtime.emit('apex_reached', {
  apex_height_m: state.maxY,
  horizontal_position_m: state.apexX,
  elapsed_seconds: state.t
})
```

**Event stream format received by the agent:**

```json
{
  "event": "apex_reached",
  "payload": {
    "apex_height_m": 5.1,
    "horizontal_position_m": 14.2,
    "elapsed_seconds": 1.02
  },
  "timestamp": 1713900000000
}
```

Student slider interactions are also emitted automatically by the runtime (no code required):

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

The parent overlay emits commitment and focus events through the same tutor observation channel:

```json
{
  "event": "prediction_sketch_submitted",
  "payload": {
    "points": [{ "x": 44, "y": 312 }, { "x": 88, "y": 260 }],
    "coordinate_space": "iframe_css_pixels"
  },
  "timestamp": 1713900000000
}
```

```json
{
  "event": "focus_selected",
  "payload": {
    "region": "apex",
    "x": 240,
    "y": 120
  },
  "timestamp": 1713900000000
}
```

The runtime remains responsible for domain events and region positions. The parent remains responsible for overlay event capture and nearest-region selection.

---

### `runtime.onLaunch(callback)` — episodic sims only

Registers a handler called when the parent sends `AGENT_CMD: launch`. The sim transitions from `idle` to `active` inside this callback. The runtime automatically sends `SIM_PHASE { phase: 'active' }` after the callback returns.

```javascript
runtime.onLaunch(() => {
  const traj = computeTrajectory(speed(), angle())
  flightTime = traj.T; rangeM = traj.R; simTime = 0
  active = true
  runtime.emit('launched', {})
})
```

Registering `onLaunch` causes the runtime to include `episodic: true` in the MANIFEST.

---

### `runtime.onReset(callback)` — episodic sims only

Registers a handler called when the parent sends `AGENT_CMD: reset`. The sim returns to `idle` inside this callback. The runtime automatically sends `SIM_PHASE { phase: 'idle' }` after the callback returns.

```javascript
runtime.onReset(() => {
  active = false; simTime = 0
})
```

---

### `runtime.reportPhase(phase)`

Sends `SIM_PHASE { phase }` to the parent. Call this when the sim reaches its terminal condition (e.g. ball hits ground) to signal the parent to show the Reset button. Valid values: `'idle'`, `'active'`, `'done'`.

```javascript
if (simTime >= flightTime) {
  active = false
  runtime.reportPhase('done')
  runtime.emit('landed', { range_m: rangeM })
}
```

Do not call `reportPhase('idle')` or `reportPhase('active')` manually — the runtime handles those transitions via `onReset` and `onLaunch`. Only `reportPhase('done')` needs to be called explicitly by sim code.

---

### `runtime.registerRegion(name, options)`

Declares a named spatial anchor in the simulation. Regions are targets the agent can pin annotations to via `add_annotation`. `options.getPosition` is required and must return `{ x, y }` in iframe-local CSS pixels, matching the parent overlay coordinate space.

```javascript
runtime.registerRegion('apex', {
  getPosition: () => ({ x: state.apexX * scale, y: height - state.apexY * scale })
})

runtime.registerRegion('landing', {
  getPosition: () => ({ x: state.x * scale, y: height })
})
```

The runtime calls `getPosition()` when region tracking is active, throttles updates to about 10fps, and sends `REGION_POSITIONS` to the parent. The agent can call `annotate('apex', 'What are the velocity components here?')` without knowing the screen coordinates. Calling `registerRegion(name)` without `getPosition` is invalid.

---

## Agent API (Parent Frame)

The parent frame exposes these calls. The AI tutor calls them as tool use.

```javascript
agentAPI.set_param(name, value)
// Sends SET_PARAM command to iframe
// Slider updates in UI, sim receives new value immediately

agentAPI.lock(paramName)
// Removes slider from student UI
// Param remains internally readable but student cannot change it

agentAPI.unlock(paramName)
// Restores slider to student UI

agentAPI.highlight(paramName)
// Applies visual emphasis to a parameter control in the sidebar (glow, border, animation)
// Params only — use add_annotation to call attention to a region inside the simulation

agentAPI.add_annotation(regionName, text)
// Pins a label to a named region
// Region tracks its position dynamically across frames

agentAPI.clear_annotations()
// Removes all active annotations

agentAPI.checkpoint()
// Snapshots full sim state — param values + internal state
// Returns snapshot index

agentAPI.restore(index)
// Rewinds to a previous checkpoint
// Useful for "what if" branching — let student explore, then reset

agentAPI.set_scene(paramOverrides)
// Resets sim to a new initial condition
// { launch_angle: 45, gravity: 4.9 }
// Equivalent to restore(0) + multiple set_param calls

agentAPI.pause()
// Stops the onUpdate tick. onRender continues — sim stays visible as a frozen frame.
// No-op (silently ignored) when manifest.animates is false.
// Iframe responds with SIM_PAUSED.

agentAPI.play()
// Resumes the onUpdate tick from current state.
// No-op when manifest.animates is false.
// Iframe responds with SIM_RESUMED.
```

---

## The Manifest

On load, the iframe sends a `MANIFEST` message to the parent. The parent uses this to:

1. **Build the slider UI** — dynamically from `params`
2. **Construct the agent's system prompt** — injecting the vocabulary of this specific sim
3. **Configure the agent bridge** — so it knows what targets are valid

```json
{
  "type": "MANIFEST",
  "params": [
    { "name": "launch_angle",    "min": 0,  "max": 90, "default": 30, "label": "Launch Angle",    "unit": "°"   },
    { "name": "initial_velocity","min": 1,  "max": 50, "default": 20, "label": "Initial Velocity", "unit": "m/s" },
    { "name": "gravity",         "min": 1,  "max": 20, "default": 9.8,"label": "Gravity",          "unit": "m/s²"}
  ],
  "regions": ["apex", "landing"],
  "events":  ["projectile_landed", "apex_reached"],
  "animates": true,
  "episodic": false
}
```

The agent's system prompt is dynamically constructed from this manifest at session start:

```
You are a Socratic tutor. You have direct control over a live simulation.

SIMULATION PARAMETERS you can control:
  - launch_angle (0–90°): currently 30°
  - initial_velocity (1–50 m/s): currently 20 m/s
  - gravity (1–20 m/s²): currently 9.8 m/s²  [locked from student]

ANNOTATION TARGETS: apex, landing

EVENTS you will receive:
  - projectile_landed { range_m, max_height_m, time_of_flight_s }
  - apex_reached { apex_height_m, horizontal_position_m }
  - param_changed { param, from, to, sim_state }

RULES:
  - Never explain the concept directly. Ask questions only.
  - Your next action is always one of: [chat message], [sim command], or [both].
  - Respond to what the student DOES (param_changed events), not just what they say.
  - Use lock() to reduce degrees of freedom early. Unlock as understanding builds.
```

---

## Multi-Agent Generation Pipeline

LLM-generated sims are produced in staged agents. This is not optional — single-shot concept → code is where reliability breaks.

### Curriculum Agent — Concept → Design Document Core

**Model**: fast, cheap (Haiku or Sonnet with low tokens)
**Input**: raw concept string from student
**Output**: structured JSON design document

```json
{
  "concept": "projectile motion",
  "domain": "physics",
  "renderer": "p5",
  "episodic": true,
  "params": [
    { "name": "launch_angle",    "range": [0, 90],  "default": 30,
      "pedagogical_note": "45° counterintuitively maximizes range" },
    { "name": "initial_velocity","range": [1, 50],  "default": 20 },
    { "name": "gravity",         "range": [1, 20],  "default": 9.8,
      "pedagogical_note": "unlock last — distracts early" }
  ],
  "governing_equations": [
    "x(t) = v₀·cos(θ)·t",
    "y(t) = v₀·sin(θ)·t - ½g·t²",
    "range = v₀²·sin(2θ) / g"
  ],
  "emit_events": ["projectile_landed", "apex_reached"],
  "register_regions": ["apex", "landing"],
  "initial_staging": {
    "locked": ["gravity"],
    "highlighted": ["launch_angle"]
  },
  "socratic_plan": [
    {
      "id": "predict_range",
      "learning_goal": "Commit to an expected range before observing the launch",
      "question": "Before you launch it, what range do you predict at 60 degrees?",
      "interaction": { "kind": "numeric_hypothesis", "metric": "range_m", "unit": "m" },
      "staging": { "lock": ["gravity"], "highlight": ["launch_angle"] },
      "expected_observation": "The student records a concrete range estimate",
      "followup_if_surprised": "Compare the predicted range with the landing point",
      "exit_condition": "A range estimate has been submitted"
    },
    {
      "id": "inspect_apex",
      "learning_goal": "Notice that vertical velocity changes while horizontal velocity persists",
      "question": "Click the part of the path where the vertical motion changes direction.",
      "interaction": { "kind": "click_to_query", "regions": ["apex"] },
      "staging": { "annotate": [{ "region": "apex", "text": "What changes here?" }] },
      "expected_observation": "The student focuses on the apex",
      "followup_if_correct": "Ask what the horizontal component is doing there",
      "exit_condition": "The apex region has been selected"
    }
  ]
}
```

### Verification-Spec Agent — Design Doc Core → Verification Block

**Model**: structured-output model
**Input**: design document core
**Output**: `verification` block (`summary`, `probes`, `invariants`)

### Sim-Builder Agent — Full Design Document → Sim Code

**Model**: Sonnet (full capability)
**Input**: design document + full SDK spec
**Output**: valid sim module

The sim-builder prompt includes:
- The complete `simRuntime` API surface (copy of this document's Core API section)
- The curriculum + verification-spec merged design document
- Hard constraints (see Generation Rules below)

**Sim-builder failure handling**: if the generated code fails validation (missing `registerParam` calls, syntax error, runtime exception on load), retry sim-builder only. The design document from curriculum + verification-spec is preserved and reused. Retry with added context: `"Previous attempt failed with: {error}. Do not repeat this mistake."`

---

## Generation Rules (Injected into Sim-Builder Prompt)

These are injected verbatim into the sim-builder system prompt to constrain output:

```
RULES — you must follow all of these:
  1. No external imports. Only `runtime` methods.
  2. No global state. All state lives inside the exported function scope.
  3. Every manipulable variable must go through registerParam. No hardcoded magic numbers.
  4. Call registerParam before onUpdate/onRender — params must exist before the loop runs.
  5. Emit events at pedagogically significant moments (state transitions, not every frame).
  6. Register all regions before the first render frame.
  7. Do not clamp inputs silently. If the student breaks the sim, let it break visibly.
     Breakage is pedagogy.
  8. The function signature is: export default function simulate(runtime) { ... }
  9. Return nothing. Do not return state.
  10. Do not implement your own animation halting (flags, booleans gating onUpdate).
      Pause/play is owned by the runtime — it stops calling onUpdate while paused.
      Sim-specific start/stop (e.g. a Launch button) is fine; global loop halting is not.
  11. If episodic is true, register onLaunch and onReset callbacks instead of drawing
      buttons inside the canvas. The parent SimControls component owns Launch/Reset/
      Pause/Play — never render control buttons in onRender.
      In onLaunch: reset state and set active = true.
      In onReset: reset state and set active = false.
      Call runtime.reportPhase('done') when the terminal condition fires (ball hits
      ground, equilibrium reached, etc.), then emit the terminal event.
      Sliders must remain adjustable in idle and done states — do not lock them in sim code.
```

---

## Renderer Variants

The runtime ships three renderer variants. The curriculum agent selects the renderer via the `"renderer"` field. The sim code is identical across all three — only the context type passed to `onRender` differs.

| Renderer | Context type | Best for |
|---|---|---|
| `p5` | p5 instance | Continuous physics, motion, particle systems, orbital mechanics |
| `canvas2d` | CanvasRenderingContext2D | Custom drawing, performance-critical sims, geometric constructions |
| `jsxgraph` | JSXGraph board instance | Mathematical / functional — derivatives, integrals, parametric curves, linear transforms |

---

## Validation

Before execution, generated code is statically validated:

```javascript
function validateSimModule(code) {
  const checks = [
    { test: /registerParam/.test(code),  error: "No params registered" },
    { test: /onUpdate|onRender/.test(code), error: "No update or render loop" },
    { test: !/document\./.test(code),    error: "Illegal DOM access" },
    { test: !/window\./.test(code),      error: "Illegal window access" },
    { test: !/import /.test(code),       error: "Illegal import statement" },
  ]
  return checks.filter(c => !c.test).map(c => c.error)
}
```

Failed validation triggers a sim-builder retry with the error message appended to the prompt. Three failures on the same concept escalates to a template fallback.

Static validation only proves that code is shaped correctly enough to run. It does not prove that the simulation is conceptually correct. After static validation passes, Praxio runs behavioral verification.

---

## Behavioral Verification

Generated simulations are teaching instruments, so correctness is not optional. The runtime supports a headless verification adapter that executes the same generated sim code without rendering UI. The adapter implements the same SDK methods as the iframe runtime, but records parameter values, emitted events, phase changes, and final metrics for deterministic probes.

```
generated sim code
        ↓
static validateSimModule()
        ↓
headless SimRuntime adapter
        ↓
run designDoc.verification.probes
        ↓
check designDoc.verification.invariants
        ↓
pass → load in iframe
fail → retry sim-builder with invariant failures
```

### Probe Execution

A probe is a named parameter configuration from the design doc:

```json
{
  "id": "angle_45",
  "params": {
    "launch_angle": 45,
    "initial_velocity": 20,
    "gravity": 9.8
  },
  "expected_metrics": ["range_m", "max_height_m", "time_of_flight_s"]
}
```

The verifier loads the sim into the headless runtime, applies the probe params through the same `set_param` path the tutor uses, advances the simulation deterministically, and collects metrics from emitted events. Episodic sims call `launch()` before stepping; continuous sims step for a bounded duration or until required events have fired.

### Invariant Checking

Invariants are machine-checkable claims about model behavior. For projectile motion:

- `approximately_equal`: 30° and 60° should produce similar range under equal launch/landing height.
- `near_maximum`: 45° should be near the maximum range among nearby tested angles.
- `monotonic`: increasing gravity should decrease range.
- `near_expected`: a known closed-form probe should match within tolerance.

If any invariant fails, the verifier returns a structured failure report such as:

```json
{
  "passed": false,
  "checks": [
    {
      "invariantId": "range_symmetry_30_60",
      "passed": false,
      "message": "Expected angle_30 and angle_60 range_m within 8%, observed 42.1 and 27.4.",
      "observed": { "angle_30": 42.1, "angle_60": 27.4 }
    }
  ]
}
```

That report is appended to the sim-builder retry prompt. The model is asked to repair the simulation code, not to rewrite the design doc. If behavioral verification still fails after the retry budget, generation falls back to a pre-verified template for the nearest supported concept/domain.

### Verification Scope

The verifier is intentionally not a theorem prover. It catches high-value conceptual failures that would be embarrassing or harmful in a demo:

- wrong qualitative relationships
- broken units or scale
- missing events needed by the tutor
- incorrect extrema or symmetry
- generated visuals that move but do not match the declared equations

This is the core Cognition-aligned augmentation: agents can generate tools, but Praxio makes them prove that the generated tools behave correctly enough for humans to rely on.

---

## Example: Full Generated Sim Module

```javascript
export default function simulate(runtime) {
  // --- Param declarations ---
  const angle    = runtime.registerParam('launch_angle',    { min: 0,  max: 90, default: 30,  label: 'Launch Angle',    unit: '°'    })
  const v0       = runtime.registerParam('initial_velocity',{ min: 1,  max: 50, default: 20,  label: 'Initial Velocity', unit: 'm/s'  })
  const gravity  = runtime.registerParam('gravity',         { min: 1,  max: 20, default: 9.8, label: 'Gravity',          unit: 'm/s²' })

  // --- Internal state ---
  const state = { x: 0, y: 0, t: 0, maxY: 0, apexX: 0, apexEmitted: false, active: false }
  const SCALE = 8
  let W, H

  // --- Region registration ---
  runtime.registerRegion('apex',    { getPosition: () => ({ x: state.apexX * SCALE, y: H - state.maxY * SCALE }) })
  runtime.registerRegion('landing', { getPosition: () => ({ x: state.x * SCALE,     y: H }) })

  // --- Episodic controls (Launch / Reset handled by parent SimControls, not drawn in canvas) ---
  runtime.onLaunch(() => {
    Object.assign(state, { x: 0, y: 0, t: 0, maxY: 0, apexX: 0, apexEmitted: false, active: true })
    runtime.emit('projectile_launched', {})
  })

  runtime.onReset(() => {
    Object.assign(state, { x: 0, y: 0, t: 0, maxY: 0, apexX: 0, apexEmitted: false, active: false })
  })

  // --- Physics ---
  runtime.onUpdate((dt) => {
    if (!state.active) return
    const rad = angle() * Math.PI / 180
    state.x += v0() * Math.cos(rad) * dt
    state.y += v0() * Math.sin(rad) * dt - 0.5 * gravity() * dt * dt
    state.t += dt

    if (state.y > state.maxY) { state.maxY = state.y; state.apexX = state.x }

    if (!state.apexEmitted && state.t > 0 && state.y < state.maxY - 0.01) {
      runtime.emit('apex_reached', { apex_height_m: state.maxY, horizontal_position_m: state.apexX })
      state.apexEmitted = true
    }

    if (state.t > 0.1 && state.y <= 0) {
      state.active = false
      runtime.reportPhase('done')
      runtime.emit('projectile_landed', { range_m: state.x, max_height_m: state.maxY, time_of_flight_s: state.t })
    }
  })

  // --- Rendering (p5) — no buttons; parent SimControls owns Launch/Reset/Pause/Play ---
  runtime.onRender((p) => {
    W = p.width; H = p.height
    p.background(245)

    p.stroke(100); p.strokeWeight(2)
    p.line(0, H - 20, W, H - 20)

    if (state.active || state.t > 0) {
      p.fill(220, 50, 50); p.noStroke()
      p.ellipse(40 + state.x * SCALE, H - 20 - state.y * SCALE, 12, 12)
    }
  })
}
```

---

## Code Generation: End-to-End

The generated sim code is never written to disk. It is a plain string in memory from the moment Claude returns it to the moment the iframe executes it. No files are created, no source files are modified.

```
User types "projectile motion"
        ↓
Frontend → generation API (curriculum-agent) → design doc core JSON in memory
        ↓
Frontend → generation API (verification-spec-agent + sim-builder-agent) → sim code as plain string in memory
        ↓
validateSimModule(codeString) — static checks before execution
        ↓
postMessage({ type: 'LOAD_SIM', code: codeString }) → iframe
        ↓
Iframe executes string via new Function() — runtime hooks register
        ↓
Iframe → postMessage({ type: 'MANIFEST', ... }) → parent
        ↓
Parent builds slider UI + agent system prompt from manifest
        ↓
Socratic session begins
```

---

## Iframe Execution Options

There are three mechanisms for executing the generated string inside the iframe. Each has different tradeoffs.

### Option A — `new Function()` (recommended for hackathon)

The iframe is pre-loaded with `simRuntime.js` and a bootstrap script. The parent sends the code string over postMessage and the bootstrap executes it:

```javascript
// Parent frame — after receiving generated code
iframeRef.current.contentWindow.postMessage({
  type: 'LOAD_SIM',
  code: generatedCodeString
}, '*')
```

```javascript
// Inside iframe — iframeHost.js (pre-loaded, written by you)
const runtime = new SimRuntime()

window.addEventListener('message', ({ data }) => {
  if (data.type === 'LOAD_SIM') {
    try {
      // runtime is injected as the argument — sim code never sees window
      const fn = new Function('runtime', data.code)
      fn(runtime)
    } catch (err) {
      parent.postMessage({ type: 'SIM_ERROR', error: err.message }, '*')
    }
  }
})
```

Claude generates the sim body without a function wrapper — `runtime` is available as an implicit argument:

```javascript
// What Claude outputs for new Function() execution
const angle = runtime.registerParam('launch_angle', { min: 0, max: 90, default: 30, label: 'Launch Angle', unit: '°' })

runtime.onUpdate((dt) => { /* physics */ })
runtime.onRender((p) => { /* draw */ })
```

**Why this is the right choice for the hackathon**: fast (no reload, no network round trip), no CSP issues, easy to retry (send a new `LOAD_SIM` message), and the iframe is already the sandbox — `new Function` inside it cannot escape.

---

### Option B — Blob URL + dynamic `import()` (cleanest module semantics)

```javascript
// Inside iframe bootstrap
window.addEventListener('message', async ({ data }) => {
  if (data.type === 'LOAD_SIM') {
    const blob = new Blob([data.code], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)

    try {
      const mod = await import(url)   // dynamic import of the blob
      mod.default(runtime)            // call the exported default
      URL.revokeObjectURL(url)
    } catch (err) {
      parent.postMessage({ type: 'SIM_ERROR', error: err.message }, '*')
    }
  }
})
```

Claude generates proper ES module syntax: `export default function simulate(runtime) { ... }`. The tradeoff: `import()` of blob URLs requires `script-src blob:` in your CSP headers and is blocked in some environments. Use Option A unless you have a specific reason to need real module scoping.

---

### Option C — `srcdoc` iframe rebuild (most isolated, slowest)

```javascript
const html = `
  <html><body>
  <script src="/simRuntime.js"></script>
  <script type="module">
    ${generatedCodeString}
    const runtime = new SimRuntime()
    simulate(runtime)
  </script>
  </body></html>
`
iframeRef.current.srcdoc = html
```

Complete isolation per sim, but ~500ms reload penalty every time. Acceptable for initial load, bad for `set_scene` or rapid concept switching during the Socratic session.

---

## Where the Claude API Call Happens

### Option 1 — Direct from frontend (simplest, fine for hackathon)

```javascript
async function generateSim(concept) {
  // Curriculum agent — concept → design doc core
  const curriculumResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: CURRICULUM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: concept }]
    })
  })
  const designDocCore = JSON.parse(curriculumResponse.content[0].text)

  // Verification-spec agent — design doc core → probes/invariants
  const verificationResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: VERIFICATION_SPEC_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(designDocCore) }]
    })
  })
  const verification = JSON.parse(verificationResponse.content[0].text)
  const designDoc = { ...designDocCore, verification }

  // Sim-builder agent — full design doc → sim code
  const simBuilderResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SIM_BUILDER_SYSTEM_PROMPT + '\n\nDESIGN DOCUMENT:\n' + JSON.stringify(designDoc, null, 2),
      messages: [{ role: 'user', content: 'Generate the simulation module.' }]
    })
  })
  const simCode = simBuilderResponse.content[0].text

  return { designDoc, simCode }
}
```

The API key is exposed in the client — acceptable for a hackathon demo, not for production.

### Option 2 — Thin backend (recommended if time allows)

A single Express or FastAPI endpoint that accepts `{ concept }` and returns `{ designDoc, simCode }`. Keeps the key server-side and lets you add logging and retry logic in one place. Worth ~30 minutes to set up.

```javascript
// Express — generation/index.js
app.post('/generate', async (req, res) => {
  const { concept } = req.body
  const designDocCore = await runCurriculumAgent(concept)
  const verification = await runVerificationSpecAgent(designDocCore)
  const designDoc = { ...designDocCore, verification }
  const simCode = await runSimBuilderAgent(designDoc)
  const errors = validateSimModule(simCode)

  if (errors.length > 0) {
    const retry = await runSimBuilderAgent(designDoc, errors)  // retry with error context
    return res.json({ designDoc, simCode: retry })
  }

  res.json({ designDoc, simCode })
})
```

---

## Full Runtime Sequence (Concrete)

```
1.  User submits "I don't understand projectile motion"

2.  generateSim("projectile motion") called
    → curriculum-agent API call → designDoc core JSON (domain, params, equations,
      socratic_plan, initial_staging, renderer)
    → verification-spec-agent API call → probes/invariants
    → sim-builder-agent API call → codeString (~50–100 lines of plain JS)

3.  validateSimModule(codeString)
    → checks: registerParam present, onUpdate/onRender present,
      no document. access, no window. access, no import statements
    → if invalid: retry sim-builder-agent with error appended to prompt
    → three consecutive failures → escalate to template fallback

4.  postMessage to iframe:
    { type: 'LOAD_SIM', code: codeString }

5.  Iframe bootstrap receives LOAD_SIM
    → new Function('runtime', codeString)(runtime)
    → registerParam() calls fire → params array populated
    → onUpdate() callback registered
    → onRender() callback registered
    → registerRegion() calls fire → regions map populated
    → animation loop starts

6.  Iframe sends MANIFEST to parent:
    { type: 'MANIFEST', params: [...], regions: [...], events: [...] }

7.  Parent receives MANIFEST
    → dynamically renders slider UI from params array
    → constructs agent system prompt by interpolating manifest fields
      (param names, ranges, current values, region names, event types)
    → initializes agent bridge with valid param/region names

8.  Agent receives initial_staging from designDoc:
    → agentAPI.lock('gravity')
    → agentAPI.highlight('launch_angle')
    → agent sends opening Socratic message

9.  Student drags a slider
    → iframe runtime detects value change
    → postMessage to parent:
      { type: 'PARAM_CHANGED', param: 'launch_angle',
        from: 30, to: 60, sim_state: { range_m: 34.3, ... } }
    → parent appends event to agent's conversation context
    → agent decides: chat message / agentAPI command / both
    → if command: postMessage to iframe { type: 'AGENT_CMD', ... }
    → Socratic loop continues
```

---

## File Structure

```
src/
  runtime/
    simRuntime.js          Core runtime class
    renderers/
      p5Renderer.js        p5.js context adapter
      canvas2dRenderer.js  Canvas 2D context adapter
      jsxgraphRenderer.js  JSXGraph scene adapter
    iframeHost.js          Iframe bootstrap — loads runtime + generated module
    agentBridge.js         Parent-side postMessage ↔ agentAPI translation
    manifestParser.js      Parses MANIFEST → slider UI + agent prompt
    validation.js          Pre-execution code checks

  generation/
    curriculumAgent.js     Concept → design document core (LLM call)
    verificationSpec.js    Design doc core → probes/invariants (LLM call)
    simBuilder.js          Full design document → sim code (LLM call)
    retryPolicy.js         Validation failure → retry with error context
    fallback.js            3-strike escalation to template registry

  components/
    SimContainer.jsx       Iframe wrapper + slider UI (built from manifest)
    TutorPanel.jsx         Chat interface + event log
    AgentControls.jsx      Debug overlay (agent commands visible to dev)
```

---

*Praxio · LA Hacks 2026 · Simulation Runtime SDK · Internal Spec*
