/**
 * Closed-form projectile helpers — keep numerically aligned with
 * public/runtime-primitives/physics.js (projectile.range).
 */
export function projectileRangeM(
  speed_mps: number,
  angle_deg: number,
  g_mps2: number,
): number {
  const g = g_mps2
  if (!(g > 0) || !Number.isFinite(speed_mps) || !Number.isFinite(angle_deg)) return NaN
  const a = (angle_deg * Math.PI) / 180
  const vx = speed_mps * Math.cos(a)
  const vy = speed_mps * Math.sin(a)
  const flightTime = (2 * vy) / g
  return vx * flightTime
}

const ANGLE_KEYS = ['launch_angle', 'angle', 'launch_angle_deg', 'theta', 'angle_deg'] as const
const SPEED_KEYS = ['initial_velocity', 'speed', 'v0', 'velocity', 'u'] as const
const G_KEYS = ['gravity', 'g', 'g_mps2'] as const

function pickParam(params: Record<string, number>, keys: readonly string[]): number | undefined {
  for (const k of keys) {
    if (k in params && typeof params[k] === 'number' && Number.isFinite(params[k])) {
      return params[k]
    }
  }
  return undefined
}

export type ProjectileParamExtract = { speed: number; angleDeg: number; g: number }

/**
 * Resolves (speed, launch angle °, g) from a probe if names look like a flat-ground projectile setup.
 */
export function extractProjectileParams(
  params: Record<string, number>,
  defaults?: { g?: number },
): ProjectileParamExtract | null {
  const angleDeg = pickParam(params, ANGLE_KEYS)
  const speed = pickParam(params, SPEED_KEYS)
  const gRaw = pickParam(params, G_KEYS)
  const g = gRaw ?? defaults?.g ?? 9.8
  if (angleDeg === undefined || speed === undefined) return null
  if (!(g > 0)) return null
  return { speed, angleDeg, g }
}
