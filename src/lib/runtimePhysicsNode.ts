/**
 * Headless/Node — same API as public/runtime-primitives/physics.js
 */
export const praxioRuntimePhysics = {
  projectile(speed_mps: number, angle_deg: number, g_mps2?: number, launch_height_m?: number) {
    const g = g_mps2 == null ? 9.8 : g_mps2
    const y0 = launch_height_m == null ? 0 : launch_height_m
    if (g <= 0) throw new Error('runtime.physics.projectile: g must be > 0')
    if (y0 < 0) throw new Error('runtime.physics.projectile: launch_height_m must be >= 0')
    const a = (angle_deg * Math.PI) / 180
    const vx = speed_mps * Math.cos(a)
    const vy = speed_mps * Math.sin(a)
    // Quadratic formula: y0 + vy*t - 0.5*g*t^2 = 0
    const flightTime = (vy + Math.sqrt(vy * vy + 2 * g * y0)) / g
    const range = vx * flightTime
    return {
      positionAt: (t: number) => ({ x_m: vx * t, y_m: vy * t - 0.5 * g * t * t }),
      velocityAt: (t: number) => ({ vx, vy: vy - g * t }),
      flightTime,
      range,
      peak: { t: vy / g, height_m: (vy * vy) / (2 * g) },
      didLand: (t: number) => t >= flightTime,
    }
  },
  shm(amplitude: number, omega_rad_s: number, phase_rad?: number) {
    const w = omega_rad_s
    const p = phase_rad == null ? 0 : phase_rad
    if (w === 0) throw new Error('runtime.physics.shm: omega must be non-zero')
    return {
      positionAt: (t: number) => amplitude * Math.sin(w * t + p),
      velocityAt: (t: number) => amplitude * w * Math.cos(w * t + p),
      period: (2 * Math.PI) / Math.abs(w),
    }
  },
  exponentialDecay(initial: number, k: number) {
    if (k < 0) throw new Error('runtime.physics.exponentialDecay: k must be >= 0')
    return {
      valueAt: (t: number) => initial * Math.exp(-k * t),
      get halfLife() {
        return k === 0 ? Infinity : Math.log(2) / k
      },
    }
  },
  elasticCollision1D(m1: number, v1: number, m2: number, v2: number) {
    const sum = m1 + m2
    if (sum === 0) throw new Error('runtime.physics.elasticCollision1D: m1 + m2 must be > 0')
    return {
      v1_final: ((m1 - m2) * v1 + 2 * m2 * v2) / sum,
      v2_final: ((m2 - m1) * v2 + 2 * m1 * v1) / sum,
    }
  },
  logisticGrowth(initial: number, k: number, carrying_capacity: number) {
    const K = carrying_capacity
    const N0 = initial
    if (K <= 0) throw new Error('runtime.physics.logisticGrowth: carrying_capacity must be > 0')
    return {
      valueAt: (t: number) => {
        if (N0 === 0) return 0
        if (N0 === K) return K
        return (K * N0) / (N0 + (K - N0) * Math.exp(-k * t))
      },
      get inflectionPoint() {
        if (k === 0 || N0 <= 0 || N0 >= K) return { t: NaN, value: K / 2 }
        return { t: (1 / k) * Math.log((K - N0) / N0), value: K / 2 }
      },
    }
  },
}
