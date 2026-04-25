import type { DesignDoc } from './types'

export type DesignDocConsistencyError = { path: string; message: string }

export type DesignDocConsistencyResult = {
  valid: boolean
  errors: DesignDocConsistencyError[]
}

function addError(
  errors: DesignDocConsistencyError[],
  path: string,
  message: string,
): void {
  errors.push({ path, message })
}

function metricInProbe(
  designDoc: DesignDoc,
  probeId: string,
  metric: string,
): boolean {
  const pr = designDoc.verification.probes.find(p => p.id === probeId)
  return pr ? pr.expected_metrics.includes(metric) : false
}

export function validateDesignDocConsistency(
  designDoc: DesignDoc,
): DesignDocConsistencyResult {
  const errors: DesignDocConsistencyError[] = []
  const paramNames = new Set<string>()
  const paramRanges = new Map<string, { min: number; max: number }>()

  for (let i = 0; i < designDoc.params.length; i++) {
    const p = designDoc.params[i]
    if (paramNames.has(p.name)) {
      addError(errors, `params[${i}].name`, `Duplicate param name: ${p.name}`)
    }
    paramNames.add(p.name)
    const [min, max] = p.range
    if (min >= max) {
      addError(errors, `params[${i}].range`, 'min must be < max')
    }
    paramRanges.set(p.name, { min, max })
    if (p.default < min || p.default > max) {
      addError(
        errors,
        `params[${i}].default`,
        `default ${p.default} outside [${min}, ${max}]`,
      )
    }
  }

  const eventSet = new Set<string>()
  for (let i = 0; i < designDoc.emit_events.length; i++) {
    const e = designDoc.emit_events[i]
    if (eventSet.has(e)) {
      addError(errors, `emit_events[${i}]`, `Duplicate event: ${e}`)
    }
    eventSet.add(e)
  }

  const regionSet = new Set<string>()
  for (let i = 0; i < designDoc.register_regions.length; i++) {
    const r = designDoc.register_regions[i]
    if (regionSet.has(r)) {
      addError(errors, `register_regions[${i}]`, `Duplicate region: ${r}`)
    }
    regionSet.add(r)
  }

  for (const id of designDoc.initial_staging.locked) {
    if (!paramNames.has(id)) {
      addError(
        errors,
        'initial_staging.locked',
        `Not a param name: ${id}`,
      )
    }
  }
  for (const id of designDoc.initial_staging.highlighted) {
    if (!paramNames.has(id)) {
      addError(
        errors,
        'initial_staging.highlighted',
        `Not a param name: ${id}`,
      )
    }
  }

  const stepIds = new Set<string>()
  for (let si = 0; si < designDoc.socratic_plan.length; si++) {
    const step = designDoc.socratic_plan[si]
    if (stepIds.has(step.id)) {
      addError(
        errors,
        `socratic_plan[${si}].id`,
        `Duplicate socratic step id: ${step.id}`,
      )
    }
    stepIds.add(step.id)

    const int = step.interaction
    if (int.kind === 'manipulate_param') {
      for (const name of int.params) {
        if (!paramNames.has(name)) {
          addError(
            errors,
            `socratic_plan[${si}].interaction.params`,
            `Not a param name: ${name}`,
          )
        }
      }
    }
    if (int.kind === 'click_to_query') {
      for (const r of int.regions) {
        if (!regionSet.has(r)) {
          addError(
            errors,
            `socratic_plan[${si}].interaction.regions`,
            `Not a registered region: ${r}`,
          )
        }
      }
    }
    if (int.kind === 'observe_event' && !eventSet.has(int.event)) {
      addError(
        errors,
        `socratic_plan[${si}].interaction.event`,
        `Not in emit_events: ${int.event}`,
      )
    }
    if (int.kind === 'prediction_sketch' && int.target_region) {
      if (!regionSet.has(int.target_region)) {
        addError(
          errors,
          `socratic_plan[${si}].interaction.target_region`,
          `Not a registered region: ${int.target_region}`,
        )
      }
    }
    if (int.kind === 'numeric_hypothesis') {
      const found = designDoc.verification.probes.some(pr =>
        pr.expected_metrics.includes(int.metric),
      )
      if (!found) {
        addError(
          errors,
          `socratic_plan[${si}].interaction.metric`,
          `metric "${int.metric}" not listed in any probe's expected_metrics`,
        )
      }
    }

    const st = step.staging
    if (st.lock) {
      for (const x of st.lock) {
        if (!paramNames.has(x)) {
          addError(
            errors,
            `socratic_plan[${si}].staging.lock`,
            `Not a param name: ${x}`,
          )
        }
      }
    }
    if (st.unlock) {
      for (const x of st.unlock) {
        if (!paramNames.has(x)) {
          addError(
            errors,
            `socratic_plan[${si}].staging.unlock`,
            `Not a param name: ${x}`,
          )
        }
      }
    }
    if (st.highlight) {
      for (const x of st.highlight) {
        if (!paramNames.has(x)) {
          addError(
            errors,
            `socratic_plan[${si}].staging.highlight`,
            `Not a param name: ${x}`,
          )
        }
      }
    }
    if (st.set_params) {
      for (const k of Object.keys(st.set_params)) {
        if (!paramNames.has(k)) {
          addError(
            errors,
            `socratic_plan[${si}].staging.set_params`,
            `Not a param name: ${k}`,
          )
        } else {
          const r = paramRanges.get(k)
          const v = st.set_params[k]
          if (r && (v < r.min || v > r.max)) {
            addError(
              errors,
              `socratic_plan[${si}].staging.set_params.${k}`,
              `value ${v} outside [${r.min}, ${r.max}]`,
            )
          }
        }
      }
    }
    if (st.annotate) {
      for (let ai = 0; ai < st.annotate.length; ai++) {
        const a = st.annotate[ai]
        if (!regionSet.has(a.region)) {
          addError(
            errors,
            `socratic_plan[${si}].staging.annotate[${ai}].region`,
            `Not a registered region: ${a.region}`,
          )
        }
      }
    }
  }

  const probeIdSet = new Set<string>()
  for (let i = 0; i < designDoc.verification.probes.length; i++) {
    const pr = designDoc.verification.probes[i]
    if (probeIdSet.has(pr.id)) {
      addError(
        errors,
        `verification.probes[${i}].id`,
        `Duplicate probe id: ${pr.id}`,
      )
    }
    probeIdSet.add(pr.id)
    if (pr.expected_metrics.length === 0) {
      addError(
        errors,
        `verification.probes[${i}].expected_metrics`,
        'expected_metrics must be non-empty',
      )
    }
    for (const m of pr.expected_metrics) {
      if (!m.trim()) {
        addError(
          errors,
          `verification.probes[${i}].expected_metrics`,
          'empty metric name',
        )
      }
    }
    for (const k of Object.keys(pr.params)) {
      if (!paramNames.has(k)) {
        addError(
          errors,
          `verification.probes[${i}].params`,
          `Not a param name: ${k}`,
        )
      } else {
        const r = paramRanges.get(k)
        const v = pr.params[k]
        if (r && (v < r.min || v > r.max)) {
          addError(
            errors,
            `verification.probes[${i}].params.${k}`,
            `value ${v} outside [${r.min}, ${r.max}]`,
          )
        }
      }
    }
  }

  const invariantIdSet = new Set<string>()
  for (let i = 0; i < designDoc.verification.invariants.length; i++) {
    const inv = designDoc.verification.invariants[i]
    if (invariantIdSet.has(inv.id)) {
      addError(
        errors,
        `verification.invariants[${i}].id`,
        `Duplicate invariant id: ${inv.id}`,
      )
    }
    invariantIdSet.add(inv.id)

    if (inv.kind === 'approximately_equal') {
      if (!probeIdSet.has(inv.left_probe)) {
        addError(
          errors,
          `verification.invariants[${i}].left_probe`,
          `Unknown probe: ${inv.left_probe}`,
        )
      } else if (!metricInProbe(designDoc, inv.left_probe, inv.metric)) {
        addError(
          errors,
          `verification.invariants[${i}].metric`,
          `metric "${inv.metric}" not in left probe's expected_metrics`,
        )
      }
      if (!probeIdSet.has(inv.right_probe)) {
        addError(
          errors,
          `verification.invariants[${i}].right_probe`,
          `Unknown probe: ${inv.right_probe}`,
        )
      } else if (!metricInProbe(designDoc, inv.right_probe, inv.metric)) {
        addError(
          errors,
          `verification.invariants[${i}].metric`,
          `metric "${inv.metric}" not in right probe's expected_metrics`,
        )
      }
    } else if (inv.kind === 'monotonic') {
      for (const pid of inv.probe_order) {
        if (!probeIdSet.has(pid)) {
          addError(
            errors,
            `verification.invariants[${i}].probe_order`,
            `Unknown probe: ${pid}`,
          )
        } else if (!metricInProbe(designDoc, pid, inv.metric)) {
          addError(
            errors,
            `verification.invariants[${i}].metric`,
            `metric "${inv.metric}" not in probe ${pid} expected_metrics`,
          )
        }
      }
    } else if (inv.kind === 'near_expected') {
      if (!probeIdSet.has(inv.probe)) {
        addError(
          errors,
          `verification.invariants[${i}].probe`,
          `Unknown probe: ${inv.probe}`,
        )
      } else if (!metricInProbe(designDoc, inv.probe, inv.metric)) {
        addError(
          errors,
          `verification.invariants[${i}].metric`,
          `metric "${inv.metric}" not in probe expected_metrics`,
        )
      }
    } else if (inv.kind === 'near_maximum') {
      if (!probeIdSet.has(inv.target_probe)) {
        addError(
          errors,
          `verification.invariants[${i}].target_probe`,
          `Unknown probe: ${inv.target_probe}`,
        )
      } else if (!metricInProbe(designDoc, inv.target_probe, inv.metric)) {
        addError(
          errors,
          `verification.invariants[${i}].metric`,
          `metric "${inv.metric}" not in target probe expected_metrics`,
        )
      }
      for (const cp of inv.comparison_probes) {
        if (!probeIdSet.has(cp)) {
          addError(
            errors,
            `verification.invariants[${i}].comparison_probes`,
            `Unknown probe: ${cp}`,
          )
        } else if (!metricInProbe(designDoc, cp, inv.metric)) {
          addError(
            errors,
            `verification.invariants[${i}].metric`,
            `metric "${inv.metric}" not in comparison probe ${cp} expected_metrics`,
          )
        }
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
