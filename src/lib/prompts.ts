import type { Manifest, DesignDoc, AppliedToolCall } from './types'

export const PASS1_SYSTEM_PROMPT = `
You are Pass 1 of Praxio's simulation pipeline.
Convert the student's concept into a pedagogically useful design document.

Your output is parsed as a strict object schema by the server.
Return only the structured data for that schema (no markdown, no prose outside fields).

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
   staging.highlight MUST only contain IDs from params[].name (never region IDs, labels, or UI element names).
   staging annotate[].region must reference register_regions.
   For numeric_hypothesis, interaction.metric MUST be copied exactly from one of verification.probes[].expected_metrics.
   Never invent metric aliases; reuse exact spelling/casing from probes.
   Use expected_observation, followup_if_correct, followup_if_surprised when reconciliation matters.
9) Keep IDs internally consistent across params, events, regions, staging, and
   socratic_plan.
10) Domain must be one of: physics, math, biology, chemistry, general.
11) episodic: set to true if the sim has a discrete launch/run/reset cycle (projectile,
    chemical reaction, etc.). Set to false for continuously evolving sims (derivative
    explorer, population growth, etc.).
12) verification: behavioral test cases that prove the sim models the concept correctly.
    The verifier executes the sim headlessly, runs each probe, and checks invariants.
    - verification.summary: one sentence stating what must be true for the sim to be trusted.
    - verification.probes: 2–8 deterministic test cases. Each probe specifies param values
      and expected_metrics (the metric names the sim will emit in event payloads, e.g.
      "range_m" for projectile motion). Use concrete, meaningful param values.
    - verification.invariants: 2–8 domain-truth checks.
    CRITICAL — each entry in verification.invariants MUST be a JSON object.
    Never use string/function shorthand (invalid: "approximately_equal(...)" or "range symmetry check").
    Every invariant object MUST include "kind", "id", and "description".
    Valid invariant object shapes (copy exactly; only probe/metric names should change):
    - {"kind":"approximately_equal","id":"inv_id","description":"...","left_probe":"probe_a","right_probe":"probe_b","metric":"metric_name","tolerance_percent":8}
    - {"kind":"monotonic","id":"inv_id","description":"...","probe_order":["probe_a","probe_b","probe_c"],"metric":"metric_name","direction":"increasing"}
    - {"kind":"near_expected","id":"inv_id","description":"...","probe":"probe_id","metric":"metric_name","expected":42,"tolerance_percent":10}
    - {"kind":"near_maximum","id":"inv_id","description":"...","target_probe":"probe_id","comparison_probes":["probe_a","probe_b"],"metric":"metric_name","tolerance_percent":5}
    - Probe IDs in invariants MUST exactly match probe IDs defined in probes[].
    - Metric names in invariants MUST match metric names listed in probes[].expected_metrics.
    - Use tolerance_percent of 5–15% to account for floating-point and timing variance.
    Example (projectile motion):
      probes: angle_30 (angle=30,v=20,g=9.8), angle_45 (angle=45,v=20,g=9.8), angle_60 (angle=60,v=20,g=9.8)
      invariants:
      [{"kind":"approximately_equal","id":"range_symmetry_30_60","description":"30 and 60 degrees should have similar range","left_probe":"angle_30","right_probe":"angle_60","metric":"range_m","tolerance_percent":8},
       {"kind":"near_maximum","id":"range_max_45","description":"45 degrees should be near maximum range","target_probe":"angle_45","comparison_probes":["angle_30","angle_60"],"metric":"range_m","tolerance_percent":5}]
`.trim()

const PASS2_RUNTIME_CONTRACT = `
RUNTIME CONTRACT (new Function execution):
- Your output is executed as: new Function('runtime', code)(runtime).
- runtime is already in scope.
- Do NOT output export syntax, module wrappers, classes, or setup boilerplate.
- Output executable JavaScript statements only.

AVAILABLE RUNTIME API:
- runtime.registerParam(name, { min, max, default, label, unit? }) -> getter function
- runtime.registerRegion(name, { getPosition: () => ({ x, y }) }) // getPosition is REQUIRED; x/y are iframe CSS pixels
- runtime.onUpdate((dt) => { ... })
- runtime.onRender((ctx) => { ... })  // ctx depends on renderer
- runtime.emit(eventName, payload) // preferred
- runtime.emitEvent(eventName, payload) // compatibility alias

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

export function buildPass2Prompt(designDoc: DesignDoc, previousErrors: string[]): string {
  const errorContext = previousErrors.length > 0
    ? `\n\nPrevious attempt failed validation with: ${previousErrors.join(', ')}. Fix every listed issue explicitly.`
    : ''

  return `You are Pass 2 of Praxio's simulation pipeline.
Generate sandbox-safe simulation code from the design document.

${PASS2_RUNTIME_CONTRACT}

${rendererCheatsheet(designDoc.renderer)}

DESIGN DOCUMENT:
${JSON.stringify(designDoc, null, 2)}

IMPLEMENTATION CHECKLIST:
- Create one registerParam call per designDoc.params entry (exact names/ranges/defaults/labels/units when present).
- Use the returned getters for physics/state updates.
- Add regions from designDoc.register_regions using runtime.registerRegion(name, { getPosition }) with iframe CSS-pixel coordinates.
- Add pedagogically meaningful event emission using designDoc.emit_events.
- Ensure onUpdate advances state and onRender draws the current state.
- Treat dt as seconds (no /1000 conversion).
- Use ONLY the APIs shown in the renderer cheatsheet above — do not invent methods.
- Keep geometry responsive to viewport/context size; avoid fixed off-screen coordinates.
- Keep code robust for malformed student interactions without hiding failures silently.
- Do not include example/demo code, comments about usage, or alternate implementations.

Return only the final JavaScript body that should be executed by new Function(runtime, code).${errorContext}`
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
  `.trim()
}

export function buildCall2SystemPrompt(
  manifest: Manifest,
  designDoc: DesignDoc,
  appliedToolCalls: AppliedToolCall[],
  activeSocraticStepId?: string,
): string {
  const stagingSummary = appliedToolCalls.length === 0
    ? 'You chose not to stage anything this turn. Respond with a Socratic move only.'
    : 'You just staged the scene by calling:\n' +
      appliedToolCalls.map(tc => `  - ${tc.toolName}(${JSON.stringify(tc.input)})`).join('\n')
  const activeStep = activeSocraticStepId
    ? `CURRENT STEP: ${activeSocraticStepId}`
    : 'CURRENT STEP: Infer the next unfinished step from the conversation and recent events.'

  return `
You are the speaking half of a Socratic tutor. You have no tools this turn; only
text. Another call already applied the sim staging below.

${stagingSummary}

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
