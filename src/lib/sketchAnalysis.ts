type Point = { x: number; y: number }

export type SketchShape = 'linear' | 'concave_down' | 'concave_up' | 'erratic'

export type SketchAnalysis = {
  shape: SketchShape
  /** Visual concavity: 'down' = dome (correct projectile arc), 'up' = valley, null if not parabolic */
  concavity: 'up' | 'down' | null
  /** Visually highest point, normalized 0–1 over canvas width */
  peak_x_norm: number
  /** Visually highest point, normalized 0–1 over canvas height (0 = top) */
  peak_y_norm: number
  direction: 'left_to_right' | 'right_to_left' | 'ambiguous'
  point_count: number
}

function subsample(points: Point[], n: number): Point[] {
  if (points.length <= n) return points
  const step = (points.length - 1) / (n - 1)
  return Array.from({ length: n }, (_, i) => points[Math.round(i * step)])
}

function fitLinear(pts: Point[]): [number, number] {
  const n = pts.length
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y }
  const denom = n * sxx - sx * sx
  if (Math.abs(denom) < 1e-10) return [0, sy / n]
  const a = (n * sxy - sx * sy) / denom
  return [a, (sy - a * sx) / n]
}

function fitQuadratic(pts: Point[]): [number, number, number] {
  const n = pts.length
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0
  for (const p of pts) {
    const x = p.x, y = p.y, x2 = x * x
    s1 += x; s2 += x2; s3 += x2 * x; s4 += x2 * x2
    t0 += y; t1 += x * y; t2 += x2 * y
  }
  // Normal equations: [[s4,s3,s2],[s3,s2,s1],[s2,s1,n]] * [a,b,c]^T = [t2,t1,t0]
  const M: number[][] = [
    [s4, s3, s2, t2],
    [s3, s2, s1, t1],
    [s2, s1, n,  t0],
  ]
  for (let i = 0; i < 3; i++) {
    let maxRow = i
    for (let k = i + 1; k < 3; k++) if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k
    ;[M[i], M[maxRow]] = [M[maxRow], M[i]]
    if (Math.abs(M[i][i]) < 1e-10) continue
    for (let k = i + 1; k < 3; k++) {
      const f = M[k][i] / M[i][i]
      for (let j = i; j <= 3; j++) M[k][j] -= f * M[i][j]
    }
  }
  const c = M[2][3] / M[2][2]
  const b = (M[1][3] - M[1][2] * c) / M[1][1]
  const a = (M[0][3] - M[0][2] * c - M[0][1] * b) / M[0][0]
  return [a, b, c].map(v => (isFinite(v) ? v : 0)) as [number, number, number]
}

function r2(pts: Point[], predict: (x: number) => number): number {
  const mean = pts.reduce((s, p) => s + p.y, 0) / pts.length
  let ssTot = 0, ssRes = 0
  for (const p of pts) { ssTot += (p.y - mean) ** 2; ssRes += (p.y - predict(p.x)) ** 2 }
  return ssTot < 1e-10 ? 1 : 1 - ssRes / ssTot
}

export function analyzeSketch(
  points: Point[],
  canvasWidth: number,
  canvasHeight: number,
): SketchAnalysis {
  const pts = subsample(points, 30)

  const [la, lb] = fitLinear(pts)
  const linR2 = r2(pts, x => la * x + lb)

  const [qa, qb, qc] = fitQuadratic(pts)
  const quadR2 = r2(pts, x => qa * x * x + qb * x + qc)

  // In CSS pixel space, y=0 is top. A projectile arc starts+ends low (large y),
  // peaks at apex (small y) → U-shape → qa > 0. Visually this is a dome = concave_down.
  let shape: SketchShape
  let concavity: 'up' | 'down' | null

  if (linR2 > 0.95) {
    shape = 'linear'
    concavity = null
  } else if (quadR2 > 0.85 && quadR2 > linR2 + 0.05) {
    concavity = qa > 0 ? 'down' : 'up'
    shape = concavity === 'down' ? 'concave_down' : 'concave_up'
  } else {
    shape = 'erratic'
    concavity = null
  }

  // Visually highest point = minimum y in CSS coords
  const peak = points.reduce((best, p) => (p.y < best.y ? p : best), points[0])

  const dx = points[points.length - 1].x - points[0].x
  const direction =
    Math.abs(dx) < canvasWidth * 0.05
      ? 'ambiguous'
      : dx > 0
        ? 'left_to_right'
        : 'right_to_left'

  return {
    shape,
    concavity,
    peak_x_norm: Math.max(0, Math.min(1, peak.x / canvasWidth)),
    peak_y_norm: Math.max(0, Math.min(1, peak.y / canvasHeight)),
    direction,
    point_count: points.length,
  }
}
