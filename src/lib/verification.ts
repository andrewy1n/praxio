import type { DesignDoc, VerificationReport, VerificationCheckResult, ProbeResult } from './types'
import { praxioRuntimeMath } from './runtimeMathNode'
import { praxioRuntimePhysics } from './runtimePhysicsNode'

// ─── Headless Runtime Adapter ─────────────────────────────────────────────────
// Executes sim code without a canvas. Stubs out all drawing calls.
// Drives onUpdate deterministically to collect emitted metrics.

type UpdateCallback = (dt: number) => void
type LaunchCallback = () => void

function buildHeadlessRuntime(paramOverrides: Record<string, number>) {
  const params: Record<string, number> = { ...paramOverrides }
  const emittedEvents: Array<{ event: string; payload: Record<string, unknown>; timestamp: number }> = []

  let updateCallback: UpdateCallback | null = null
  let launchCallback: LaunchCallback | null = null
  let phaseDone = false

  const runtime = {
    physics: praxioRuntimePhysics,
    math: praxioRuntimeMath,
    registerParam(name: string, opts: { min: number; max: number; default: number; label: string; unit?: string }) {
      if (!(name in params)) {
        params[name] = opts.default
      }
      return () => params[name]
    },
    registerRegion(_name: string, _opts: unknown) {},
    registerEvent(_name: string) {},
    onUpdate(cb: UpdateCallback) { updateCallback = cb },
    onRender(_cb: unknown) {},
    emit(eventName: string, payload: Record<string, unknown>) {
      emittedEvents.push({ event: eventName, payload, timestamp: Date.now() })
    },
    emitEvent(eventName: string, payload: Record<string, unknown>) {
      this.emit(eventName, payload)
    },
    onLaunch(cb: LaunchCallback) { launchCallback = cb },
    onReset(_cb: unknown) {},
    reportPhase(phase: string) {
      if (phase === 'done') phaseDone = true
    },
  }

  return {
    runtime,
    emittedEvents,
    getUpdateCallback: () => updateCallback,
    getLaunchCallback: () => launchCallback,
    isPhaseDone: () => phaseDone,
  }
}

function runProbe(
  simCode: string,
  paramOverrides: Record<string, number>,
  isEpisodic: boolean,
): { metrics: Record<string, number>; events: Array<{ event: string; payload: Record<string, unknown>; timestamp: number }> } {
  const { runtime, emittedEvents, getUpdateCallback, getLaunchCallback, isPhaseDone } =
    buildHeadlessRuntime(paramOverrides)

  try {
    // eslint-disable-next-line no-new-func
    new Function('runtime', simCode)(runtime)
  } catch {
    return { metrics: {}, events: [] }
  }

  const updateFn = getUpdateCallback()
  if (!updateFn) return { metrics: {}, events: [] }

  const launchFn = getLaunchCallback()
  if (isEpisodic && launchFn) {
    try { launchFn() } catch { return { metrics: {}, events: emittedEvents } }
  }

  // Step at 60fps equivalent, max 60 simulation seconds
  const DT = 1 / 60
  const MAX_STEPS = 60 * 60

  for (let i = 0; i < MAX_STEPS; i++) {
    try { updateFn(DT) } catch { break }
    if (isPhaseDone()) break
  }

  // Collect numeric metrics from all emitted event payloads
  const metrics: Record<string, number> = {}
  for (const ev of emittedEvents) {
    if (ev.payload && typeof ev.payload === 'object') {
      for (const [key, val] of Object.entries(ev.payload)) {
        if (typeof val === 'number') {
          metrics[key] = val
        }
      }
    }
  }

  return { metrics, events: emittedEvents }
}

// ─── Invariant Checkers ───────────────────────────────────────────────────────

function checkInvariant(
  invariant: DesignDoc['verification']['invariants'][number],
  probeResultMap: Map<string, ProbeResult>,
): VerificationCheckResult {
  switch (invariant.kind) {
    case 'approximately_equal': {
      const left = probeResultMap.get(invariant.left_probe)?.metrics[invariant.metric]
      const right = probeResultMap.get(invariant.right_probe)?.metrics[invariant.metric]
      if (left === undefined || right === undefined) {
        return {
          invariantId: invariant.id,
          passed: false,
          message: `Cannot check "${invariant.id}": metric "${invariant.metric}" missing in probe(s). Got left=${left}, right=${right}`,
          observed: { left: left ?? NaN, right: right ?? NaN },
        }
      }
      const avg = (Math.abs(left) + Math.abs(right)) / 2
      const diff = Math.abs(left - right)
      const pct = avg === 0 ? (diff === 0 ? 0 : Infinity) : (diff / avg) * 100
      const passed = pct <= invariant.tolerance_percent
      return {
        invariantId: invariant.id,
        passed,
        message: passed
          ? `${invariant.description}: ${left.toFixed(2)} ≈ ${right.toFixed(2)} (${pct.toFixed(1)}% diff ≤ ${invariant.tolerance_percent}%)`
          : `${invariant.description}: ${left.toFixed(2)} vs ${right.toFixed(2)} — ${pct.toFixed(1)}% diff exceeds ${invariant.tolerance_percent}% tolerance`,
        observed: { left, right },
      }
    }

    case 'monotonic': {
      const values = invariant.probe_order.map(id => ({
        id,
        val: probeResultMap.get(id)?.metrics[invariant.metric],
      }))
      const missing = values.filter(v => v.val === undefined)
      if (missing.length > 0) {
        return {
          invariantId: invariant.id,
          passed: false,
          message: `Cannot check "${invariant.id}": metric "${invariant.metric}" missing in probes: ${missing.map(v => v.id).join(', ')}`,
        }
      }
      const nums = values.map(v => v.val as number)
      let isMonotonic = true
      for (let i = 1; i < nums.length; i++) {
        if (invariant.direction === 'increasing' && nums[i] <= nums[i - 1]) { isMonotonic = false; break }
        if (invariant.direction === 'decreasing' && nums[i] >= nums[i - 1]) { isMonotonic = false; break }
      }
      const observed: Record<string, number> = {}
      values.forEach(v => { observed[v.id] = v.val as number })
      return {
        invariantId: invariant.id,
        passed: isMonotonic,
        message: isMonotonic
          ? `${invariant.description}: ${invariant.direction} ✓ [${nums.map(n => n.toFixed(2)).join(' → ')}]`
          : `${invariant.description}: NOT ${invariant.direction} [${nums.map(n => n.toFixed(2)).join(' → ')}]`,
        observed,
      }
    }

    case 'near_expected': {
      const observedVal = probeResultMap.get(invariant.probe)?.metrics[invariant.metric]
      if (observedVal === undefined) {
        return {
          invariantId: invariant.id,
          passed: false,
          message: `Cannot check "${invariant.id}": metric "${invariant.metric}" missing in probe "${invariant.probe}"`,
        }
      }
      const pct = invariant.expected === 0
        ? (Math.abs(observedVal) < 0.001 ? 0 : Infinity)
        : Math.abs((observedVal - invariant.expected) / invariant.expected) * 100
      const passed = pct <= invariant.tolerance_percent
      return {
        invariantId: invariant.id,
        passed,
        message: passed
          ? `${invariant.description}: ${observedVal.toFixed(2)} near expected ${invariant.expected} (${pct.toFixed(1)}% off)`
          : `${invariant.description}: ${observedVal.toFixed(2)} not near expected ${invariant.expected} (${pct.toFixed(1)}% off, limit ${invariant.tolerance_percent}%)`,
        observed: { observed: observedVal, expected: invariant.expected },
      }
    }

    case 'near_maximum': {
      const targetVal = probeResultMap.get(invariant.target_probe)?.metrics[invariant.metric]
      if (targetVal === undefined) {
        return {
          invariantId: invariant.id,
          passed: false,
          message: `Cannot check "${invariant.id}": metric "${invariant.metric}" missing in target probe "${invariant.target_probe}"`,
        }
      }
      const compVals = invariant.comparison_probes.map(id => ({
        id,
        val: probeResultMap.get(id)?.metrics[invariant.metric],
      }))
      const missingComp = compVals.filter(v => v.val === undefined)
      if (missingComp.length > 0) {
        return {
          invariantId: invariant.id,
          passed: false,
          message: `Cannot check "${invariant.id}": metric missing in comparison probes: ${missingComp.map(v => v.id).join(', ')}`,
        }
      }
      const observed: Record<string, number> = { [invariant.target_probe]: targetVal }
      compVals.forEach(v => { observed[v.id] = v.val as number })

      const tolerance = invariant.tolerance_percent / 100
      const allBelow = compVals.every(cv => {
        const compVal = cv.val as number
        // target must be at least (1 - tolerance) * compVal
        return targetVal >= compVal * (1 - tolerance)
      })
      return {
        invariantId: invariant.id,
        passed: allBelow,
        message: allBelow
          ? `${invariant.description}: target ${targetVal.toFixed(2)} is near maximum [${compVals.map(cv => `${cv.id}=${cv.val?.toFixed(2)}`).join(', ')}]`
          : `${invariant.description}: target ${targetVal.toFixed(2)} is NOT near maximum [${compVals.map(cv => `${cv.id}=${cv.val?.toFixed(2)}`).join(', ')}]`,
        observed,
      }
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function verifySimBehavior(
  simCode: string,
  designDoc: DesignDoc,
): Promise<VerificationReport> {
  const { probes, invariants } = designDoc.verification

  const probeResultMap = new Map<string, ProbeResult>()
  const probeResults: ProbeResult[] = []

  for (const probe of probes) {
    const { metrics, events } = runProbe(simCode, probe.params, designDoc.episodic)
    const result: ProbeResult = {
      probeId: probe.id,
      params: probe.params,
      metrics,
      events,
    }
    probeResults.push(result)
    probeResultMap.set(probe.id, result)
  }

  const checks = invariants.map(inv => checkInvariant(inv, probeResultMap))
  const passed = checks.every(c => c.passed)

  return { passed, checks, probeResults }
}

export function formatVerificationFailures(report: VerificationReport): string[] {
  return report.checks
    .filter(c => !c.passed)
    .map(c => c.message)
}
