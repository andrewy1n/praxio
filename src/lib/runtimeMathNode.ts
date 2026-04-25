/**
 * Headless/Node — same API as public/runtime-primitives/math.js
 */
import { all, create } from 'mathjs'

const m = create(all)

function toNum(v: unknown): number {
  if (v == null) return NaN
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'object' && v !== null && 're' in v) return Number((v as { re: number }).re)
  return Number(v)
}

function trapezoidIntegral(fn: (x: number) => number, a: number, b: number, n: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  if (a === b) return 0
  const h = (b - a) / n
  let s = 0.5 * (fn(a) + fn(b))
  for (let i = 1; i < n; i += 1) s += fn(a + h * i)
  return s * h
}

export const praxioRuntimeMath = {
  derivative(exprString: string, x: number) {
    const node = m.parse(String(exprString))
    const d = m.derivative(node, 'x')
    return toNum(d.compile().evaluate({ x }))
  },
  integral(f: string | ((x: number) => number), a: number, b: number) {
    if (typeof f === 'function') return trapezoidIntegral(f, a, b, 1024)
    const node = m.parse(String(f))
    const compiled = node.compile()
    return trapezoidIntegral(
      xx => toNum(compiled.evaluate({ x: xx })),
      a, b, 2048,
    )
  },
  evaluate(exprString: string, scope?: Record<string, unknown>) {
    return m.evaluate(String(exprString), scope ?? {})
  },
  taylorCoefficients(exprString: string, center: number | null | undefined, terms: number) {
    const c = center == null ? 0 : center
    const n = Math.max(1, Math.floor(terms) || 1)
    let cur = m.parse(String(exprString))
    const out: Array<{ degree: number; coefficient: number }> = []
    for (let deg = 0; deg < n; deg += 1) {
      const valAtC = toNum(cur.compile().evaluate({ x: c }))
      const coeff = m.divide(valAtC, m.factorial(deg))
      out.push({ degree: deg, coefficient: toNum(coeff) })
      cur = m.derivative(cur, 'x')
    }
    return out
  },
  complex(re: number, im?: number) {
    return m.complex(re, im ?? 0)
  },
}
