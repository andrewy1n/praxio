# Primitives Library — Proposal
### Praxio — LA Hacks 2026

---

## Problem

The current two-pass generation pipeline fails behavioral verification at a high rate. The root cause is not structural — `prompts.ts` already prescribes SDK conformance, episodic lifecycle, region getPosition, and dt-in-seconds — but **correctness of generated math and physics**.

Generated sims frequently fail invariants like range symmetry and 45°-max-range because:

1. **Coordinate system flips are silent.** Screen y-down vs physics y-up. One missed sign inversion makes visuals look fine but emits wrong metric values.
2. **Metric emission timing is fragile.** The invariant reads `range_m` from the `landed` event. Models emit at the wrong phase boundary, or compute range from velocity at peak-time instead of landing.
3. **Pass 1 occasionally generates physically false invariants.** "Range monotonically increases from 30° → 45° → 60°" is incorrect (60° ≈ 30° by symmetry). If Pass 1 invents a wrong invariant, Pass 2 can never satisfy it.
4. **Integration accumulates error.** dt-stepped Euler integrators accumulate floating-point drift over a full flight, causing final `range_m` to diverge from closed-form by more than the probe tolerance.

Scaffolding templates does not fix this — the prompts already provide the structural contract. The issue is that physics and math equations written inline by the model are wrong often enough to make generation unreliable.

---

## Proposal: `runtime.physics` and `runtime.math`

Add two namespaces to `simRuntime.js`. Pass 2 picks the appropriate primitive and wires it to params + rendering. The model no longer writes the integrator or numerical method.

**Physics primitives are hand-written** (~5–15 lines each). They are pure closed-form algebra — no library is worth the dependency for formulas this simple.

**Math primitives are powered by [`mathjs`](https://mathjs.org/)**, loaded as a script tag in the iframe HTML files. `mathjs` covers symbolic derivatives, numerical integration, expression evaluation, matrix ops, and complex numbers — far more than could be hand-written reliably.

---

## `runtime.physics` Interface

```javascript
// Projectile under constant gravity
const traj = runtime.physics.projectile(speed_mps, angle_deg, g_mps2)
// traj.positionAt(t)       → { x_m, y_m }  (y=0 at launch, y>0 upward)
// traj.velocityAt(t)       → { vx, vy }
// traj.flightTime          → number (seconds)
// traj.range               → number (meters)
// traj.peak                → { t, height_m }
// traj.didLand(t)          → boolean

// Simple harmonic motion
const shm = runtime.physics.shm(amplitude, omega_rad_s, phase_rad)
// shm.positionAt(t)        → number
// shm.velocityAt(t)        → number
// shm.period               → number (seconds)

// Exponential decay
const decay = runtime.physics.exponentialDecay(initial, k)
// decay.valueAt(t)         → number
// decay.halfLife           → number (seconds)

// 1D elastic collision (returns post-collision velocities)
const col = runtime.physics.elasticCollision1D(m1, v1, m2, v2)
// col.v1_final, col.v2_final

// Logistic growth
const logistic = runtime.physics.logisticGrowth(initial, k, carrying_capacity)
// logistic.valueAt(t)      → number
// logistic.inflectionPoint → { t, value }
```

All primitives use closed-form solutions. Where integration is unavoidable, the primitive uses fixed-step RK4 at sub-dt precision so the simulator's dt doesn't determine accuracy.

### Example — projectile primitive implementation

```javascript
runtime.physics.projectile = (speed, angle_deg, g = 9.8) => {
  const a = angle_deg * Math.PI / 180
  const vx = speed * Math.cos(a), vy = speed * Math.sin(a)
  const flightTime = 2 * vy / g
  return {
    positionAt: (t) => ({ x_m: vx * t, y_m: vy * t - 0.5 * g * t * t }),
    velocityAt: (t) => ({ vx, vy: vy - g * t }),
    flightTime,
    range: vx * flightTime,
    peak: { t: vy / g, height_m: vy * vy / (2 * g) },
    didLand: (t) => t >= flightTime,
  }
}
```

---

## `runtime.math` Interface (powered by mathjs)

```javascript
// Symbolic derivative — returns the derivative value at x
runtime.math.derivative(exprString, x)
// e.g. runtime.math.derivative('x^3 + 2*x', 2) → 14

// Numerical integration over [a, b]
runtime.math.integral(f, a, b)
// e.g. runtime.math.integral(x => x * x, 0, 3) → 9

// Evaluate a math expression string with variable bindings
runtime.math.evaluate(exprString, scope)
// e.g. runtime.math.evaluate('2 * x + sin(y)', { x: 3, y: 0 }) → 6

// Taylor series coefficients around a center point
runtime.math.taylorCoefficients(exprString, center, terms)
// returns array of { degree, coefficient }

// Complex number arithmetic
runtime.math.complex(re, im)   // wraps mathjs complex
```

mathjs is loaded via script tag in each iframe HTML before `simRuntime.js`:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/mathjs/13.2.0/math.min.js"></script>
<script src="/simRuntime.js"></script>
```

`simRuntime.js` then wires `runtime.math` as a thin facade over the `math` global.

---

## How Pass 2 Uses This

For projectile motion, Pass 2 becomes:

```javascript
const getSpeed = runtime.registerParam('speed', { ... })
const getAngle = runtime.registerParam('angle', { ... })
const getGravity = runtime.registerParam('gravity', { ... })

let simTime = 0, active = false, traj = null

runtime.registerRegion('peak_trajectory', {
  getPosition: () => {
    const t = traj ? traj.peak.t : 0
    const p = traj ? traj.positionAt(t) : { x_m: 0, y_m: 0 }
    return { x: LAUNCH_X + p.x_m * SCALE, y: groundY() - p.y_m * SCALE }
  }
})

runtime.onLaunch(() => {
  traj = runtime.physics.projectile(getSpeed(), getAngle(), getGravity())
  simTime = 0; active = true
})

runtime.onUpdate((dt) => {
  if (!active) return
  simTime += dt
  if (traj.didLand(simTime)) {
    active = false
    runtime.emit('landed', { range_m: traj.range, time_of_flight_s: traj.flightTime })
  }
})

runtime.onRender((ctx) => {
  const pos = traj ? traj.positionAt(simTime) : { x_m: 0, y_m: 0 }
  // ... all visual richness unchanged ...
})
```

For a derivative explorer (JSXGraph), Pass 2 becomes:

```javascript
const getX = runtime.registerParam('x', { min: -5, max: 5, default: 1, label: 'x' })

runtime.onRender((board) => {
  const slope = runtime.math.derivative('x^3 - 3*x', getX())
  // update tangent line position on board ...
})
```

The model still writes all rendering, region, and event code. Only the correctness-critical computation moves to the primitive.

---

## Why Invariants Now Pass

- Range symmetry at 30°/60° is exact by construction (`sin(60°) = sin(120°)`).
- 45° near-max is exact by construction (`sin(90°) = 1`).
- Derivative slope matches finite-difference by construction (mathjs uses exact symbolic differentiation).
- Metric emission is deterministic: `traj.flightTime` is a property, not a frame-step accumulation.

The remaining failure surface:
- Model wires wrong param to wrong primitive argument — catchable by a name-match check in Pass 1.
- Pass 1 generates a physically false invariant — fixable by the self-check step below.

---

## Companion Fix: Pass 1 Invariant Self-Check

After Pass 1 generates invariants, validate them analytically server-side before any Pass 2 call. For `approximately_equal` on a projectile concept, compute `range(probe_a)` and `range(probe_b)` using the closed-form formula and reject if they violate the invariant. Catches hallucinated invariants in <1ms with no model call.

Recommendation: block and retry Pass 1 once on failure; on second failure, warn and continue so the freeform fallback still fires.

---

## Domain Coverage

| Domain | Approach | Covers |
|---|---|---|
| Physics | Hand-written primitives | Projectile, SHM, decay, collision, logistic growth |
| Math | mathjs facade | Derivatives, integrals, expression eval, Taylor series, complex numbers |
| Biology | Physics primitives (logistic, decay) | Population dynamics, pharmacokinetics |
| Chemistry | Physics primitives (decay) | First-order reactions, half-life |
| Other | Freeform generation (today's behavior) | Diffusion, fluid dynamics, 3-body, coupled ODEs |

Concepts outside covered domains fall back to freeform generation. The fallback path is identical to current behavior — no regression.

---

## Tradeoffs

**Loses:**
- Model cannot invent custom physics for covered domains. "Gravity varying with altitude" needs to override the primitive or fall back to freeform.
- Visual metaphors tied to exaggerated physics (slow-motion apex) require post-processing primitive output.
- mathjs CDN dependency in iframe HTML — adds ~200kb (minified), ~1 extra HTTP request.

**Gains:**
- Behavioral verification passes reliably for covered concepts.
- Retry loop shrinks or disappears for covered concepts → generation time drops significantly.
- Pass 1 invariant self-check catches model mistakes before any Pass 2 call.
- Less prompt sensitivity: gravity sign, dt handling, metric emission timing become non-issues.
- Math sims (derivatives, integrals) become as reliable as physics sims.

---

## Implementation Scope

1. **`public/iframe/*.html`** — add mathjs CDN script tag before `simRuntime.js` in all four iframe HTML files.
2. **`public/simRuntime.js`** — add `runtime.physics` namespace (5 hand-written primitives, ~120 lines) and `runtime.math` facade over mathjs global (~30 lines).
3. **`src/lib/prompts.ts` (Pass 2 prompt)** — add `PRIMITIVES` section listing available namespaces and signatures. Instruct the model to use one when the concept matches.
4. **`src/lib/prompts.ts` (Pass 1 prompt)** — add `primitive` as an optional field in the design doc schema so Pass 1 declares intent and Pass 2 can match it.
5. **`src/lib/verification.ts`** — add server-side invariant self-check using the same closed-form formulas. Run immediately after Pass 1, before Pass 2.
6. **`lib/types.ts`** — add `primitive?: string` to `DesignDoc`.

Estimated implementation time: ~4–5h. Does not require changes to the tutor, iframe protocol, or MongoDB schema.

---

## Open Questions

- Should `runtime.physics` and `runtime.math` be documented in `simulation-runtime-sdk.md` as first-class SDK surfaces, or kept as internal generation aids? (Recommendation: document them — the tutor may eventually want to read primitive-derived metrics directly.)
- Should mathjs be bundled into `simRuntime.js` at build time rather than loaded from CDN? (Recommendation: CDN for now to keep the build simple; bundle if CSP or offline requirements emerge.)
- How does this interact with the preset fallback registry? If primitives make generation reliable, presets become less critical as a safety net. They remain useful as visual quality references.
