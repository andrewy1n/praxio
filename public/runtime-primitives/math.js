/**
 * Praxio — runtime.math facade over mathjs global (loaded before this script in iframe)
 */
;(function (global) {
  'use strict'

  function getMath() {
    if (!global.math) {
      throw new Error('runtime.math: mathjs is not loaded (load math.min.js before this script)')
    }
    return global.math
  }

  function toNum(v) {
    if (v == null) return NaN
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'object' && typeof v.re === 'number') return v.re
    return Number(v)
  }

  function trapezoidIntegral(fn, a, b, n) {
    n = n || 1024
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
    if (a === b) return 0
    var h = (b - a) / n
    var s = 0.5 * (fn(a) + fn(b))
    for (var i = 1; i < n; i += 1) s += fn(a + h * i)
    return s * h
  }

  global.__praxioRuntimeMath = {
    derivative: function (exprString, x) {
      var m = getMath()
      var node = m.parse(String(exprString))
      var d = m.derivative(node, 'x')
      return toNum(d.compile().evaluate({ x }))
    },
    integral: function (f, a, b) {
      if (typeof f === 'function') return trapezoidIntegral(f, a, b, 1024)
      var m2 = getMath()
      var node = m2.parse(String(f))
      var compiled = node.compile()
      return trapezoidIntegral(
        function (xx) { return toNum(compiled.evaluate({ x: xx })) },
        a, b, 2048
      )
    },
    evaluate: function (exprString, scope) {
      return getMath().evaluate(String(exprString), scope || {})
    },
    taylorCoefficients: function (exprString, center, terms) {
      var m3 = getMath()
      var c = center == null ? 0 : center
      var n = Math.max(1, Math.floor(terms) || 1)
      var cur = m3.parse(String(exprString))
      var out = []
      for (var deg = 0; deg < n; deg += 1) {
        var valAtC = toNum(cur.compile().evaluate({ x: c }))
        var coeff = m3.divide(valAtC, m3.factorial(deg))
        out.push({ degree: deg, coefficient: toNum(coeff) })
        cur = m3.derivative(cur, 'x')
      }
      return out
    },
    complex: function (re, im) {
      return getMath().complex(re, im)
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
