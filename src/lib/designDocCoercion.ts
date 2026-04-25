/**
 * Normalizes common LLM mistakes before DesignDoc Zod validation.
 * Used as z.preprocess input — keep in sync with DesignDocSchema fields.
 */

function normalizeInteraction(raw: unknown): unknown {
  if (typeof raw === 'string') {
    const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
    const byKey: Record<string, Record<string, unknown>> = {
      verbal_response: { kind: 'verbal_response' },
      verbal: { kind: 'verbal_response' },
      discussion: { kind: 'verbal_response' },
      manipulate_param: { kind: 'manipulate_param', params: [] },
      manipulate: { kind: 'manipulate_param', params: [] },
      prediction_sketch: { kind: 'prediction_sketch' },
      sketch: { kind: 'prediction_sketch' },
      numeric_hypothesis: { kind: 'numeric_hypothesis', metric: 'value' },
      click_to_query: { kind: 'click_to_query', regions: [] },
    }
    return byKey[key] ?? { kind: 'verbal_response' }
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    if (typeof o.kind === 'string') return raw
    if (typeof o.type === 'string' && !o.kind) return normalizeInteraction(o.type)
  }
  return raw
}

function normalizeParam(p: unknown): unknown {
  if (p == null || typeof p !== 'object' || Array.isArray(p)) return p
  const o = { ...(p as Record<string, unknown>) }

  if (!Array.isArray(o.range)) {
    const min = o.min ?? o.minimum
    const max = o.max ?? o.maximum
    if (min != null && max != null) {
      const nMin = Number(min)
      const nMax = Number(max)
      if (Number.isFinite(nMin) && Number.isFinite(nMax)) o.range = [nMin, nMax]
    }
  }

  if (typeof o.default === 'string' && o.default.trim() !== '') {
    const n = Number(o.default)
    if (Number.isFinite(n)) o.default = n
  }

  return o
}

function normalizeSocraticStep(step: unknown): unknown {
  if (step == null || typeof step !== 'object' || Array.isArray(step)) return step
  const s = { ...(step as Record<string, unknown>) }
  s.interaction = normalizeInteraction(s.interaction)
  return s
}

function normalizeRenderer(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const r = raw.trim().toLowerCase()
  const aliases: Record<string, string> = {
    'p5.js': 'p5',
    p5js: 'p5',
    canvas: 'canvas2d',
    canvas_2d: 'canvas2d',
    '2d': 'canvas2d',
    jsx_graph: 'jsxgraph',
    matter_js: 'matter',
    matterjs: 'matter',
  }
  return aliases[r] ?? r
}

function normalizeEpisodic(raw: unknown): unknown {
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase()
    if (s === 'true' || s === 'yes' || s === '1') return true
    if (s === 'false' || s === 'no' || s === '0') return false
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw !== 0
  return raw
}

/** Top-level design doc JSON from the model → shape closer to DesignDocSchema */
export function coerceDesignDocJson(input: unknown): unknown {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return input

  const d = { ...(input as Record<string, unknown>) }

  if (typeof d.domain === 'string') d.domain = d.domain.trim().toLowerCase()
  d.renderer = normalizeRenderer(d.renderer)
  d.episodic = normalizeEpisodic(d.episodic)
  if (typeof d.primitive === 'string') d.primitive = d.primitive.trim()

  if (Array.isArray(d.params)) d.params = d.params.map(normalizeParam)

  if (d.initial_staging && typeof d.initial_staging === 'object' && !Array.isArray(d.initial_staging)) {
    const s = d.initial_staging as Record<string, unknown>
    d.initial_staging = {
      locked: Array.isArray(s.locked) ? s.locked.map(String) : [],
      highlighted: Array.isArray(s.highlighted) ? s.highlighted.map(String) : [],
    }
  }

  if (Array.isArray(d.socratic_plan)) d.socratic_plan = d.socratic_plan.map(normalizeSocraticStep)

  return d
}
