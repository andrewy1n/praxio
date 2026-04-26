import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { validateDesignDocConsistency } from './designDocConsistency'
import { DesignDocSchema, type DesignDoc } from './types'

function loadPreset(name: string): DesignDoc {
  const p = path.join(
    process.cwd(),
    'public',
    'presets',
    name,
    'design-doc.json',
  )
  const raw = readFileSync(p, 'utf8')
  return DesignDocSchema.parse(JSON.parse(raw))
}

test('projectile preset passes consistency', () => {
  const doc = loadPreset('projectile-motion')
  const r = validateDesignDocConsistency(doc)
  assert.equal(r.valid, true, r.errors.map(e => `${e.path}: ${e.message}`).join('\n'))
})

test('population-growth preset passes consistency', () => {
  const doc = loadPreset('population-growth')
  const r = validateDesignDocConsistency(doc)
  assert.equal(r.valid, true, r.errors.map(e => `${e.path}: ${e.message}`).join('\n'))
})

test('rejects staging.launch when not episodic', () => {
  const doc = loadPreset('projectile-motion')
  const bad: DesignDoc = {
    ...doc,
    episodic: false,
    socratic_plan: doc.socratic_plan.map((s, i) =>
      i === 0 ? { ...s, staging: { ...s.staging, launch: true } } : s,
    ),
  }
  const r = validateDesignDocConsistency(bad)
  assert.equal(r.valid, false)
  assert.ok(r.errors.some(e => e.path.includes('staging.launch')))
})

test('rejects unknown param in initial_staging', () => {
  const doc = loadPreset('projectile-motion')
  const bad: DesignDoc = {
    ...doc,
    initial_staging: {
      locked: ['not_a_param'],
      highlighted: [],
    },
  }
  const r = validateDesignDocConsistency(bad)
  assert.equal(r.valid, false)
  assert.ok(r.errors.some(e => e.path.includes('initial_staging')))
})

test('rejects invariant referencing unknown probe', () => {
  const doc = loadPreset('projectile-motion')
  const inv = doc.verification.invariants[0]
  if (inv.kind !== 'approximately_equal') throw new Error('expected first invariant')
  const bad: DesignDoc = {
    ...doc,
    verification: {
      ...doc.verification,
      invariants: [
        {
          ...inv,
          left_probe: 'no_such_probe',
        },
      ],
    },
  }
  const r = validateDesignDocConsistency(bad)
  assert.equal(r.valid, false)
})
