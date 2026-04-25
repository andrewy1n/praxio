/**
 * Praxio — physics primitives (closed-form), iframe + headless must match
 * @see src/lib/physicsAnalytic.ts (TypeScript mirror for server/verification)
 */
;(function (global) {
  'use strict'

  function projectile(speed_mps, angle_deg, g_mps2) {
    const g = g_mps2 == null ? 9.8 : g_mps2
    if (g <= 0) throw new Error('runtime.physics.projectile: g must be > 0')
    const a = (angle_deg * Math.PI) / 180
    const vx = speed_mps * Math.cos(a)
    const vy = speed_mps * Math.sin(a)
    const flightTime = (2 * vy) / g
    const range = vx * flightTime
    return {
      positionAt(t) {
        return { x_m: vx * t, y_m: vy * t - 0.5 * g * t * t }
      },
      velocityAt(t) {
        return { vx, vy: vy - g * t }
      },
      flightTime,
      range,
      peak: { t: vy / g, height_m: (vy * vy) / (2 * g) },
      didLand(t) {
        return t >= flightTime
      },
    }
  }

  function shm(amplitude, omega_rad_s, phase_rad) {
    const w = omega_rad_s
    const p = phase_rad == null ? 0 : phase_rad
    if (w === 0) throw new Error('runtime.physics.shm: omega must be non-zero')
    return {
      positionAt(t) {
        return amplitude * Math.sin(w * t + p)
      },
      velocityAt(t) {
        return amplitude * w * Math.cos(w * t + p)
      },
      period: (2 * Math.PI) / Math.abs(w),
    }
  }

  function exponentialDecay(initial, k) {
    if (k < 0) throw new Error('runtime.physics.exponentialDecay: k must be >= 0')
    return {
      valueAt(t) {
        return initial * Math.exp(-k * t)
      },
      get halfLife() {
        return k === 0 ? Infinity : Math.log(2) / k
      },
    }
  }

  function elasticCollision1D(m1, v1, m2, v2) {
    const sum = m1 + m2
    if (sum === 0) throw new Error('runtime.physics.elasticCollision1D: m1 + m2 must be > 0')
    return {
      v1_final: ((m1 - m2) * v1 + 2 * m2 * v2) / sum,
      v2_final: ((m2 - m1) * v2 + 2 * m1 * v1) / sum,
    }
  }

  function logisticGrowth(initial, k, carrying_capacity) {
    const K = carrying_capacity
    const N0 = initial
    if (K <= 0) throw new Error('runtime.physics.logisticGrowth: carrying_capacity must be > 0')
    return {
      valueAt(t) {
        if (N0 === 0) return 0
        if (N0 === K) return K
        return (K * N0) / (N0 + (K - N0) * Math.exp(-k * t))
      },
      get inflectionPoint() {
        if (k === 0 || N0 <= 0 || N0 >= K) return { t: NaN, value: K / 2 }
        return { t: (1 / k) * Math.log((K - N0) / N0), value: K / 2 }
      },
    }
  }

  global.__praxioRuntimePhysics = {
    projectile,
    shm,
    exponentialDecay,
    elasticCollision1D,
    logisticGrowth,
  }
})(typeof window !== 'undefined' ? window : globalThis)
