import type { DesignDoc, Invariant } from './types'
import { extractProjectileParams, projectileRangeM } from './physicsAnalytic'

function shouldCheckProjectileInvariants(designDoc: DesignDoc): boolean {
  const p = designDoc.primitive?.toLowerCase() ?? ''
  if (p.includes('projectile')) return true
  if (p.includes('trajectory') && p.includes('flat')) return true
  if (designDoc.domain === 'physics' && /projectile|ballistic|trajectory|range.*angle/i.test(designDoc.concept)) {
    return true
  }
  return false
}

function pctDiff(a: number, b: number): number {
  const avg = (Math.abs(a) + Math.abs(b)) / 2
  if (avg === 0) return a === 0 && b === 0 ? 0 : Infinity
  return (Math.abs(a - b) / avg) * 100
}

/**
 * Rejects merged design doc when verification claims are impossible for ideal flat-ground projectiles
 * (analytic range from probe params).
 */
export function runVerificationInvariantSelfCheck(
  designDoc: DesignDoc,
): { ok: true } | { ok: false; message: string } {
  if (!shouldCheckProjectileInvariants(designDoc)) return { ok: true }
  if (designDoc.domain !== 'physics') return { ok: true }

  const prim = designDoc.primitive?.toLowerCase() ?? ''
  const invariants = designDoc.verification.invariants as Invariant[]

  for (const inv of invariants) {
    if (inv.kind === 'approximately_equal' && inv.metric === 'range_m') {
      const leftProbe = designDoc.verification.probes.find(pr => pr.id === inv.left_probe)
      const rightProbe = designDoc.verification.probes.find(pr => pr.id === inv.right_probe)
      if (!leftProbe || !rightProbe) {
        return {
          ok: false,
          message: `invariant ${inv.id} references missing probe(s) ${inv.left_probe} / ${inv.right_probe}`,
        }
      }
      const a = extractProjectileParams(leftProbe.params)
      const b = extractProjectileParams(rightProbe.params)
      if (!a || !b) {
        if (prim.includes('projectile')) {
          return {
            ok: false,
            message: `invariant ${inv.id}: probes must include resolvable keys for flat-ground range (e.g. launch_angle, initial_velocity, gravity) so self-check can run`,
          }
        }
        continue
      }

      const r1 = projectileRangeM(a.speed, a.angleDeg, a.g)
      const r2 = projectileRangeM(b.speed, b.angleDeg, b.g)
      if (!Number.isFinite(r1) || !Number.isFinite(r2)) {
        return { ok: false, message: `invariant ${inv.id}: could not compute analytic ranges` }
      }
      const diff = pctDiff(r1, r2)
      if (diff > inv.tolerance_percent) {
        return {
          ok: false,
          message: `invariant ${inv.id}: for flat-ground projectile, analytic range_m differs by ${diff.toFixed(1)}% (limit ${inv.tolerance_percent}%). Probes: ${leftProbe.id} ≈ ${r1.toFixed(3)} m, ${rightProbe.id} ≈ ${r2.toFixed(3)} m — adjust probes or invariants (e.g. 30° vs 60° at same v₀ and g are nearly equal; they cannot be monotonically "increasing range" 30→45→60 as separate probes).`,
        }
      }
    }
  }
  return { ok: true }
}
