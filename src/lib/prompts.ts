import type { Manifest, DesignDoc, AppliedToolCall } from './types'

/** Curriculum agent: concept → design doc core (no verification block). */
export const CURRICULUM_SYSTEM_PROMPT = `
You are the curriculum agent of Praxio's simulation pipeline.
Convert the student's concept into a pedagogically useful design document (scene + Socratic plan only).

Your output is parsed as a strict object schema by the server.
Return only the structured data for that schema (no markdown, no prose outside fields).
Do NOT include a verification field — a separate step adds probes and invariants.

Requirements:
1) Keep the design doc minimal, coherent, and teachable in one interactive scene.
2) Choose 2-5 manipulable parameters that drive conceptual insight.
   - Use stable snake_case parameter IDs (e.g. launch_angle, initial_velocity).
   - Each param must have a numeric range [min, max] with min < max.
   - default must be inside range.
   - label should be student-readable.
   - unit is optional but preferred when meaningful.
3) Choose renderer by concept fit:
   - p5: continuous motion/physics and animated dynamics
   - canvas2d: custom drawing or diffusion/particle visuals
   - jsxgraph: graphs, geometry, and mathematical constructions
   - matter: collisions/rigid-body interactions
4) governing_equations should be concise canonical relationships for the concept.
5) emit_events should be sparse, discrete, and pedagogically meaningful state transitions
   (snake_case event IDs; not per-frame spam).
6) register_regions should be concrete visual landmarks the tutor may annotate
   (snake_case region IDs).
7) initial_staging:
   - locked/highlighted entries must reference existing parameter IDs exactly.
   - keep this small (0-2 locks, 1-2 highlights).
8) socratic_plan: 2-6 steps; each step pairs one Socratic question with how the
   student acts before the tutor advances.
   CRITICAL — field "interaction" must ALWAYS be a JSON object with key "kind".
   Never set interaction to a bare string (invalid: "interaction": "verbal_response").
   Valid shapes (copy structure exactly; omit only optional keys you do not need):
   - {"kind":"verbal_response"}
   - {"kind":"manipulate_param","params":["param_id",...]}  // param IDs from params[]
   - {"kind":"prediction_sketch","target_region":"region_id"}  // target_region optional
   - {"kind":"numeric_hypothesis","metric":"short_name","unit":"symbol"}  // unit optional
   - {"kind":"click_to_query","regions":["region_id",...]}  // IDs must be in register_regions
   - {"kind":"observe_event","event":"event_id"}  // must be in emit_events
   Pedagogy: verbal_response = reason aloud; manipulate_param = drag sliders;
   prediction_sketch = sketch before seeing outcome; numeric_hypothesis = guess a number;
   click_to_query = focus a region; observe_event = wait for a sim event.
   staging lock/highlight/set_params must reference existing param IDs;
   staging.launch: optional boolean; only when episodic is true (triggers one sim launch after param staging in the client);
   staging.highlight MUST only contain IDs from params[].name (never region IDs, labels, or UI element names).
   staging annotate[].region must reference register_regions.
   For numeric_hypothesis, use a stable short metric name (snake_case) the sim will emit. The verification step lists that exact string on every probe that needs it — avoid one-off names.
   Projectile (physics.projectile or same pedagogy without primitive): for "how far" / range questions use metric "range_m"; for "how long in the air" use "time_of_flight_s". For a guess of launch angle in degrees, use "angle" only if the sim emits that key. Do NOT use invented names like "max_range_angle", "optimal_angle", or "best_range_m" — they will fail consistency. Prefer rephrasing the step so the student hypothesizes range (range_m) when the lesson is about distance.
   Use expected_observation, followup_if_correct, followup_if_surprised when reconciliation matters.
9) Optional "primitive" (string): for covered domains, set so the sim-builder can use built-in math:
   - "physics.projectile" — flat ground, constant g; do NOT require impossible invariants. Range is (v0^2 sin(2θ))/g. Complementary launch angles (e.g. 30° and 60°) have equal range for the same v0 and g. Use param names: launch_angle, initial_velocity, gravity.
   - "math.expression" — use runtime.math (derivatives, integrals) for correctness on JSXGraph.
   - Omit the field for freeform sims outside these packs.
   - When choosing a primitive, make param naming compatible with that primitive's canonical API.
10) Keep IDs internally consistent across params, events, regions, staging, and
   socratic_plan.
11) Domain must be one of: physics, math, biology, chemistry, general.
12) episodic: set to true if the sim has a discrete launch/run/reset cycle (projectile,
    chemical reaction, etc.). Set to false for continuously evolving sims (derivative
    explorer, population growth, etc.).
`.trim()

/** Verification-spec agent: design doc core → verification block only. */
export const VERIFICATION_SPEC_SYSTEM_PROMPT = `
You are the verification-spec agent. You receive a design document core (JSON) that already
defines params, events, regions, socratic plan, and optional primitive. Your only job is to
add behavioral test cases: verification.summary, verification.probes, verification.invariants.

The verifier will execute the sim headlessly, run each probe, and check invariants.
Output ONLY the verification object (summary, probes, invariants) as strict JSON — no wrapper, no markdown.

Rules:
- verification.summary: one sentence stating what must be true for the sim to be trusted.
- verification.probes: 2–8 deterministic test cases. Each probe: id, description, params (param name → number within existing param ranges), expected_metrics (metric names the sim will emit in event payloads, e.g. "range_m").
- First, read NUMERIC_HYPOTHESIS_METRICS from the user prompt. Then ensure every listed metric appears in expected_metrics (exact string) on at least one probe.
- Probe params must use the exact param names from the design doc core; do not leave params empty. Include all design-doc params on each probe unless impossible.
- Valid probe shape (params is an ARRAY of {name, value} objects — every design-doc param must appear):
  {"id":"probe_id","description":"...","params":[{"name":"launch_angle","value":30},{"name":"initial_velocity","value":25},{"name":"gravity","value":9.81},{"name":"launch_height","value":0}],"expected_metrics":["range_m","time_of_flight_s"]}
- Every numeric_hypothesis step in the socratic plan uses interaction.metric: that string MUST appear in at least one probe's expected_metrics (exact spelling).
- Projectile lessons: probes should list the metrics the sim emits (typically "range_m", often "time_of_flight_s"). Every socratic numeric_hypothesis.metric must appear on ≥1 probe — if core asks for a range guess, use "range_m" in expected_metrics everywhere that probe runs range checks.
- verification.invariants: 2–8 machine-checkable domain claims.
- CRITICAL: each entry in invariants is a JSON object (never string shorthand).
- Valid invariant kinds (copy structure; only ids/probes/metrics change):
  - {"kind":"approximately_equal","id":"inv_id","description":"...","left_probe":"probe_a","right_probe":"probe_b","metric":"metric_name","tolerance_percent":8}
  - {"kind":"monotonic","id":"inv_id","description":"...","probe_order":["a","b","c"],"metric":"metric_name","direction":"increasing"|"decreasing"}
  - {"kind":"near_expected","id":"inv_id","description":"...","probe":"probe_id","metric":"metric_name","expected":42,"tolerance_percent":10}
  - {"kind":"near_maximum","id":"inv_id","description":"...","target_probe":"pid","comparison_probes":["a","b"],"metric":"metric_name","tolerance_percent":5}
- Probe/invariant/metric names must be consistent. tolerance_percent: 5–15% for float variance.
- For projectile (primitive physics.projectile): never claim monotonic range vs angle from 30°→45°→60°; 30° and 60° often have near-equal range at fixed v0 and g.
`.trim()

const SIM_BUILDER_RUNTIME_CONTRACT_HEADER = `
RUNTIME CONTRACT (new Function execution):
- Your output is executed as: new Function('runtime', code)(runtime).
- runtime is already in scope.
- Do NOT output export syntax, module wrappers, classes, or setup boilerplate.
- Output executable JavaScript statements only.

AVAILABLE RUNTIME API:
- runtime.registerParam(name, { min, max, default, label, unit? }) -> getter function
  registerParam returns a getter function only. Use getter() to read current value.
- runtime.registerRegion(name, { getPosition: () => ({ x, y }) }) // x/y are iframe CSS pixels
- runtime.onUpdate((dt) => { ... })
- runtime.onRender((ctx) => { ... })  // ctx depends on renderer
- runtime.emit(eventName, payload) // preferred
- runtime.emitEvent(eventName, payload) // compatibility alias

EPISODIC SIMS — use runtime.episodic() (preferred over raw onLaunch/onReset/reportPhase):
  runtime.episodic({
    onLaunch() { /* ball fired, reaction started, etc. — set any "running" flags here */ },
    onReset()  { /* clear trajectory, reset counters, return to idle visual */ },
  });
  // Signal end-of-episode (e.g. ball landed, reaction complete) — safe to call every frame,
  // fires reportPhase('done') exactly once per episode:
  runtime.endEpisode()

COORDINATE TRANSFORM — call once per render (or on resize) so region positions stay current:
  runtime.setCoordinateTransform({ originX, originY, scaleX, scaleY })
  // originX/Y: screen pixel where physics (0,0) sits
  // scaleX/Y:  pixels per physics unit (scaleY flips y — physics up becomes screen down)
  runtime.toScreenX(x_physics)  // → CSS pixel x
  runtime.toScreenY(y_physics)  // → CSS pixel y (y-axis flipped automatically)
  // Returns 0 before setCoordinateTransform is called — region callbacks are safe pre-launch.
`.trim()

const SIM_BUILDER_RUNTIME_CONTRACT_HARD_RULES = `
HARD RULES:
1) No imports/require.
2) No document/window/globalThis/DOM access.
3) Register ALL parameters from the design doc using EXACT param names.
4) Call registerParam before onUpdate/onRender.
5) Register ALL regions from the design doc before first render loop usage, each with a getPosition callback.
6) Include both runtime.onUpdate(...) and runtime.onRender(...).
7) Emit only design-doc event IDs, at meaningful state transitions.
8) Keep all mutable state in local variables/objects in this generated code.
9) No markdown fences. No surrounding explanation. Code only.
10) dt passed to onUpdate is already in seconds. NEVER divide dt by 1000.
11) Keep visuals on-screen: avoid hardcoded absolute baselines like fixed originY=550.
    Derive drawing bounds from the render context dimensions.
12) Never call registerRegion(name) without getPosition. Region positions power tutor highlights and annotations.
`.trim()

function primitivesBlock(primitive?: string): string {
  if (!primitive) {
    return 'PRIMITIVES: None selected — implement physics/math from scratch.'
  }

  const blocks: Record<string, string> = {
    'physics.projectile': `PRIMITIVES (closed-form — do not reimplement the integrator):
- runtime.physics.projectile(speed_mps, angle_deg, g_mps2) → { positionAt(t), velocityAt(t), flightTime, range, peak, didLand(t) } — y=0 at launch, y>0 up.
  Exact nested shapes:
  - positionAt(t) returns { x_m: number, y_m: number } (NOT x/y)
  - velocityAt(t) returns { vx: number, vy: number }
  - peak is { t: number, height_m: number } (NOT time/x/y)
  - didLand(t) returns boolean
  Required usage:
  - Emit range_m from traj.range on landing (NOT from sampled position drift).
  - Emit time_of_flight_s from traj.flightTime when landing occurs.
  - Never read positionAt(...).x or .y; never read peak.time/peak.x/peak.y.
You MUST use runtime.physics.projectile for flight path, range, and metrics.

COORDINATE TRANSFORM for physics.projectile — call at top of onRender to keep regions accurate:
  const scale = (ctx.width * 0.8) / traj.range   // fit trajectory across 80% of canvas width
  runtime.setCoordinateTransform({
    originX: ctx.width * 0.1,   // left margin
    originY: ctx.height * 0.85, // ground level
    scaleX: scale,
    scaleY: scale,
  })
  // Then region getPosition callbacks are trivial:
  //   launch_point:    { x: runtime.toScreenX(0),              y: runtime.toScreenY(0) }
  //   peak_trajectory: { x: runtime.toScreenX(traj.range / 2), y: runtime.toScreenY(traj.peak.height_m) }
  //   landing_point:   { x: runtime.toScreenX(traj.range),     y: runtime.toScreenY(0) }
  // Use a fallback traj (default params) before first launch so positions are non-zero from the start.`,

    'physics.shm': `PRIMITIVES (closed-form — do not reimplement the integrator):
- runtime.physics.shm(amplitude, omega_rad_s, phase_rad) → { positionAt(t), velocityAt(t), period }
You MUST use runtime.physics.shm for oscillation state.`,

    'physics.exponentialDecay': `PRIMITIVES (closed-form — do not reimplement the integrator):
- runtime.physics.exponentialDecay(initial, k) → { valueAt(t), halfLife }
You MUST use runtime.physics.exponentialDecay for decay state.`,

    'physics.elasticCollision1D': `PRIMITIVES (closed-form — do not reimplement the integrator):
- runtime.physics.elasticCollision1D(m1, v1, m2, v2) → { v1_final, v2_final }
You MUST use runtime.physics.elasticCollision1D for collision outcomes.`,

    'physics.logisticGrowth': `PRIMITIVES (closed-form — do not reimplement the integrator):
- runtime.physics.logisticGrowth(initial, k, carrying_capacity) → { valueAt(t), inflectionPoint }
You MUST use runtime.physics.logisticGrowth for population state.`,

    'math.expression': `PRIMITIVES (closed-form — do not reimplement these):
- runtime.math.derivative(exprString, x) — x numeric
- runtime.math.integral(f, a, b) — f is a JS function, or a string expression in x
- runtime.math.evaluate(exprString, scope)
- runtime.math.taylorCoefficients(exprString, center, terms) — returns [{ degree, coefficient }, ...]
- runtime.math.complex(re, im)
You MUST use runtime.math for stated derivatives/integrals.`,
  }

  return blocks[primitive] ?? `PRIMITIVES: Unknown primitive "${primitive}" — implement physics/math from scratch.`
}

function buildRuntimeContract(primitive?: string): string {
  return [SIM_BUILDER_RUNTIME_CONTRACT_HEADER, primitivesBlock(primitive), SIM_BUILDER_RUNTIME_CONTRACT_HARD_RULES].join('\n\n')
}

function rendererCheatsheet(renderer: DesignDoc['renderer']): string {
  switch (renderer) {
    case 'p5': return `
RENDERER CHEATSHEET — p5 (ctx is a p5 instance in instance mode):
  ctx.width / ctx.height          — canvas dimensions
  ctx.background(r, g, b)
  ctx.fill(r, g, b) / ctx.noFill()
  ctx.stroke(r, g, b) / ctx.noStroke()
  ctx.strokeWeight(n)
  ctx.ellipse(x, y, w, h)
  ctx.rect(x, y, w, h)
  ctx.line(x1, y1, x2, y2)
  ctx.triangle(x1,y1, x2,y2, x3,y3)
  ctx.beginShape(); ctx.vertex(x,y); ctx.endShape()
  ctx.text(str, x, y)
  ctx.textSize(n) / ctx.textAlign(ctx.LEFT, ctx.TOP)
  ctx.push() / ctx.pop()
  ctx.translate(x, y) / ctx.scale(sx, sy)
  ctx.map(val, lo1, hi1, lo2, hi2)  — remap a value between ranges`.trim()

    case 'canvas2d': return `
RENDERER CHEATSHEET — canvas2d (ctx is a CanvasRenderingContext2D):
  ctx.canvas.width / ctx.canvas.height  — canvas dimensions
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = 'rgb(r,g,b)' / ctx.strokeStyle = '...'
  ctx.lineWidth = n
  ctx.beginPath()
  ctx.moveTo(x, y) / ctx.lineTo(x, y)
  ctx.arc(x, y, r, startAngle, endAngle)
  ctx.rect(x, y, w, h)
  ctx.fill() / ctx.stroke() / ctx.closePath()
  ctx.fillRect(x, y, w, h)
  ctx.fillText(str, x, y) / ctx.font = '14px monospace'
  ctx.save() / ctx.restore()
  ctx.translate(x, y) / ctx.scale(sx, sy)`.trim()

    case 'jsxgraph': return `
RENDERER CHEATSHEET — jsxgraph (ctx is a JXG.Board):
  RULE: ONLY use ctx.create(type, args, attrs). Never ctx.createPoint / ctx.createLine / ctx.createFunction — those do not exist.

  // Point
  const pt = ctx.create('point', [x, y], { name: 'P', color: 'black', size: 3 });

  // Function graph
  const fg = ctx.create('functiongraph', [(x) => x * x, -5, 5], { strokeColor: 'blue', strokeWidth: 2 });

  // Line through two points
  const ln = ctx.create('line', [pt1, pt2], { strokeColor: 'red', strokeWidth: 2 });

  // Segment between two points
  const seg = ctx.create('segment', [pt1, pt2], { strokeColor: 'green' });

  // Circle: center point + radius number
  const circ = ctx.create('circle', [pt, 2], { strokeColor: 'orange' });

  // Text label
  const lbl = ctx.create('text', [x, y, 'hello'], { fontSize: 14 });

  // Update a point's position (must pass JXG.COORDS_BY_USER)
  pt.setPosition(JXG.COORDS_BY_USER, [newX, newY]);

  // After any mutations, trigger a board redraw
  ctx.update();

  // Create elements ONCE (guard with a null-check flag), then mutate in onUpdate/onRender.
  // JSXGraph renders itself — onRender only needs mutations + ctx.update().`.trim()

    case 'matter': return `
RENDERER CHEATSHEET — matter (ctx = { Matter, engine, world }):
  const { Matter, engine, world } = ctx;
  const { Bodies, Body, Composite, Events } = Matter;

  // Create bodies
  const box    = Bodies.rectangle(x, y, w, h, { restitution: 0.8 });
  const circle = Bodies.circle(x, y, r, { friction: 0.05 });
  const ground = Bodies.rectangle(x, y, w, h, { isStatic: true });

  // Add / remove
  Composite.add(world, [box, ground]);
  Composite.remove(world, box);

  // Step the engine manually in onUpdate
  Matter.Engine.update(engine, dt * 1000);  // dt is seconds, Matter wants ms

  // Read body state
  body.position.x / body.position.y
  body.velocity.x / body.velocity.y
  body.angle

  // Apply forces / impulses
  Body.applyForce(body, body.position, { x: fx, y: fy });
  Body.setVelocity(body, { x: vx, y: vy });

  // onRender receives the same ctx — draw bodies manually using canvas2d or p5
  // (Matter has no built-in renderer in this runtime; you must draw yourself).`.trim()
  }
}

/** Max chars of previous sim code embedded in the repair prompt (avoid huge system prompts). */
export const SIM_BUILDER_PREVIOUS_CODE_PROMPT_MAX = 100_000

export type SimBuilderRepairIntent = 'static_repair' | 'behavioral_repair'

export type BuildSimBuilderPromptOptions = {
  previousSimCode?: string
  repairIntent?: SimBuilderRepairIntent
}

function formatPreviousSimForPrompt(code: string): { block: string; truncated: boolean } {
  const len = code.length
  if (len <= SIM_BUILDER_PREVIOUS_CODE_PROMPT_MAX) {
    return { block: code, truncated: false }
  }
  return {
    block: `${code.slice(0, SIM_BUILDER_PREVIOUS_CODE_PROMPT_MAX)}\n\n[... truncated: ${len} total chars; fix issues in the visible portion and keep structure consistent ...]`,
    truncated: true,
  }
}

function repairModeBlock(intent: SimBuilderRepairIntent): string {
  if (intent === 'static_repair') {
    return `
REPAIR MODE (static validation):
- You are revising a previous candidate. Make the smallest set of edits needed to satisfy the runtime contract and the listed validation failures.
- Preserve working structure: keep registerParam names, register_region IDs, emit_events usage, and the overall onUpdate/onRender flow unless a failure requires changing them.
- Do not refactor for style. Do not rename variables for clarity. Do not add alternate implementations.
`.trim()
  }
  return `
REPAIR MODE (behavioral verification):
- You are revising a previous candidate that already passes static checks. Make the smallest set of edits so headless probes satisfy the design document's verification invariants (metrics in event payloads, physics/math consistency, etc.).
- Preserve param names, region IDs, event IDs, and render/update structure unless an invariant fix requires a targeted change.
- Do not rewrite the sim from scratch unless the failures are unfixable with local edits.
`.trim()
}

export function buildSimBuilderPrompt(
  designDoc: DesignDoc,
  previousErrors: string[],
  extraHint = '',
  options?: BuildSimBuilderPromptOptions,
): string {
  const previousSimCode = options?.previousSimCode?.trim()
  const repairIntent = options?.repairIntent
  const isRepair = Boolean(previousSimCode && repairIntent)

  const errorContext = [
    previousErrors.length > 0
      ? isRepair && repairIntent
        ? `Issues to fix (${repairIntent === 'behavioral_repair' ? 'verification / invariants' : 'static validation'}): ${previousErrors.join(', ')}. Address every listed item.`
        : `Previous attempt failed validation with: ${previousErrors.join(', ')}. Fix every listed issue explicitly.`
      : '',
    extraHint,
  ]
    .filter(Boolean)
    .join('\n\n')

  const previousCodeSection = (() => {
    if (!isRepair || !previousSimCode || !repairIntent) return ''
    const { block, truncated } = formatPreviousSimForPrompt(previousSimCode)
    const truncNote = truncated ? ' (prompt truncated from full source)' : ''
    return `

${repairModeBlock(repairIntent)}

PREVIOUS SIMULATION CODE (revise this; output a full replacement body, not a diff)${truncNote}:
${block}
`
  })()

  return `You are the sim-builder agent of Praxio's simulation pipeline.
${isRepair ? 'Revise the simulation code to satisfy the design document and the issues below.' : 'Generate sandbox-safe simulation code from the design document.'}

${buildRuntimeContract(designDoc.primitive)}

${rendererCheatsheet(designDoc.renderer)}

DESIGN DOCUMENT:
${JSON.stringify(designDoc, null, 2)}

IMPLEMENTATION CHECKLIST:
- Create one registerParam call per designDoc.params entry (exact names/ranges/defaults/labels/units when present).
- Use the returned getters for physics/state updates.
- If designDoc.primitive is set, use runtime.physics / runtime.math as required in the contract above.
- Add regions from designDoc.register_regions using runtime.registerRegion(name, { getPosition }) with iframe CSS-pixel coordinates.
- Add pedagogically meaningful event emission using designDoc.emit_events.
- Ensure onUpdate advances state and onRender draws the current state.
- Treat dt as seconds (no /1000 conversion).
- Use ONLY the APIs shown in the renderer cheatsheet above — do not invent methods.
- Keep geometry responsive to viewport/context size; avoid fixed off-screen coordinates.
- Keep code robust for malformed student interactions without hiding failures silently.
- Do not include example/demo code, comments about usage, or alternate implementations.
${previousCodeSection}
Return only the final JavaScript body that should be executed by new Function(runtime, code).${errorContext ? `\n\n${errorContext}` : ''}`
}

function formatSocraticPlan(designDoc: DesignDoc): string {
  return designDoc.socratic_plan.map((step, index) => {
    const staging = Object.entries(step.staging)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('; ') || 'none'
    const optionalContext = [
      step.expected_observation ? `expected: ${step.expected_observation}` : null,
      step.followup_if_correct ? `if correct: ${step.followup_if_correct}` : null,
      step.followup_if_surprised ? `if surprised: ${step.followup_if_surprised}` : null,
    ].filter(Boolean).join(' | ')

    return [
      `  ${index + 1}. ${step.id}: ${step.learning_goal}`,
      `     question: ${step.question}`,
      `     interaction: ${JSON.stringify(step.interaction)}`,
      `     staging: ${staging}`,
      optionalContext ? `     ${optionalContext}` : null,
      `     exit: ${step.exit_condition}`,
    ].filter(Boolean).join('\n')
  }).join('\n')
}

export function buildCall1SystemPrompt(
  manifest: Manifest,
  designDoc: DesignDoc,
  activeSocraticStepId?: string,
): string {
  const activeStep = activeSocraticStepId
    ? `CURRENT STEP: ${activeSocraticStepId}`
    : 'CURRENT STEP: Infer the next unfinished step from the conversation and recent events.'

  return `
You are the staging half of a Socratic tutor. Your ONLY job this turn is to decide
which sim actions (if any) to fire. Do not speak. Do not explain. Return tool calls
only. If no staging is needed for this turn, return zero tool calls.

SIMULATION PARAMETERS you can control:
${manifest.params.map(p =>
  `  - ${p.name} (${p.min}–${p.max}${p.unit ? ' ' + p.unit : ''}): currently ${p.default}`
).join('\n')}

ANNOTATION TARGETS: ${manifest.regions.join(', ')}

EVENTS you can receive:
${manifest.events.map(e => `  - ${e}`).join('\n')}
  - param_changed { param, from, to, sim_state }
  - prediction_sketch_submitted { points: [{x,y}...], coordinate_space }
  - hypothesis_submitted { metric, value, unit? }
  - focus_selected { region, x, y }

SOCRATIC PLAN:
${formatSocraticPlan(designDoc)}

${activeStep}

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

STEP ADVANCEMENT (advance_step tool):
  - The CURRENT STEP above is the only step the student is working on. The UI does
    NOT auto-complete steps based on slider moves, submits, clicks, or sim events.
    The only way to mark the current step done and move to the next one is for YOU
    to call advance_step in this turn.
  - Call advance_step only when the latest student action or utterance clearly
    satisfies the CURRENT step's exit_condition, listed in the Socratic plan above.
    Examples of satisfied exit conditions: the student committed a prediction
    sketch, submitted a numeric hypothesis, selected the requested region,
    articulated a prediction or stated uncertainty, noticed the asked-about
    pattern, or connected the observation to the concept.
  - Do NOT call advance_step just because the student spoke, submitted, or moved a
    slider — evaluate whether what they said or did actually addresses the current
    step's learning goal.
  - Do NOT call advance_step on the LAST step of the plan; the session ends
    differently there.
  - Call advance_step at most once per turn. It can be combined with other staging
    tool calls for the next step (e.g. highlight, unlock) in the same turn.
  `.trim()
}

export function buildCall2SystemPrompt(
  manifest: Manifest,
  designDoc: DesignDoc,
  appliedToolCalls: AppliedToolCall[],
  activeSocraticStepId?: string,
  stepQuestionReadAloud?: boolean,
): string {
  const stagingSummary = appliedToolCalls.length === 0
    ? 'You chose not to stage anything this turn. Respond with a Socratic move only.'
    : 'You just staged the scene by calling:\n' +
      appliedToolCalls.map(tc => `  - ${tc.toolName}(${JSON.stringify(tc.input)})`).join('\n')
  const activeStep = activeSocraticStepId
    ? `CURRENT STEP: ${activeSocraticStepId}`
    : 'CURRENT STEP: Infer the next unfinished step from the conversation and recent events.'

  const readAloudBlock = stepQuestionReadAloud
    ? `
STEP QUESTION (VOICE) — read-aloud was already used:
  The current step’s question or task was already read aloud to the student when
  they entered this step (separate TTS, not in the message history). Their first
  message is a reply in that context.
  - Do NOT repeat, re-read, or restate the full step question or long task wording.
  - Do NOT open with a duplicate of the same instruction they already heard.
  - Respond to their latest message. If it is a brief acknowledgment, filler, or
    meta question (e.g. "okay", "what now", "what happens?"), give ONE short
    concrete nudge toward what the step’s interaction needs (e.g. sketch, drag a
    slider, click a region) without paraphrasing the entire prompt.
`.trim()
    : ''

  return `
You are the speaking half of a Socratic tutor. You have no tools this turn; only
text. Another call already applied the sim staging below.

${stagingSummary}

${readAloudBlock}

HARD RULES:
  - NEVER explain the concept directly. You are forbidden from declarative answers.
  - Respond with a question, a prediction prompt, or a directive to manipulate the sim.
  - If recent prediction_sketch_submitted or hypothesis_submitted events exist and are
    relevant, ask about the gap between prediction and observation before introducing a
    new concept thread.
  - If a recent focus_selected exists, usually make the next question about that region.
  - Only confirm/validate when the student has clearly arrived at the answer themselves.
  - Speak in short sentences. One question per turn.
  - Ground your speech in the staging above.

SIMULATION CONTEXT:
${manifest.params.map(p =>
  `  - ${p.name} (${p.min}–${p.max}${p.unit ? ' ' + p.unit : ''})`
).join('\n')}

SOCRATIC PLAN:
${formatSocraticPlan(designDoc)}

${activeStep}
  `.trim()
}
