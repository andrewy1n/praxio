const getD  = runtime.registerParam('diffusion_coeff',       { label: 'Diffusion Coefficient (D)', min: 0.05, max: 1.5,  default: 0.3, unit: '' })
const getC0 = runtime.registerParam('initial_concentration', { label: 'Initial Concentration',       min: 0.3,  max: 1.0,  default: 0.8, unit: '' })

runtime.registerEvent('half_equilibrium')
runtime.registerEvent('near_equilibrium')

// Simulation grid — 1-D finite differences on N cells, dx=1
const N = 50
const SPEED = 200  // simulation time units per real second
let conc = new Float64Array(N)
let next = new Float64Array(N)
let halfFired = false, nearFired = false
let simTime = 0
let prevD = null, prevC0 = null
let isPausing = false, pauseTime = 0
const PAUSE_DURATION = 2.0  // seconds to hold the equilibrium view before looping

// Region positions updated each render frame
let rLeft    = { x: 100, y: 150 }
let rRight   = { x: 300, y: 150 }
let rGradient = { x: 200, y: 150 }
runtime.registerRegion('left_chamber',  { getPosition: () => rLeft })
runtime.registerRegion('right_chamber', { getPosition: () => rRight })
runtime.registerRegion('gradient_zone', { getPosition: () => rGradient })

function resetConc(c0) {
  for (let i = 0; i < N; i++) conc[i] = i < N / 2 ? c0 : 0
  halfFired = false
  nearFired = false
  isPausing = false
  pauseTime = 0
  simTime = 0
}

runtime.onUpdate(function(dt) {
  const D = getD(), c0 = getC0()
  if (D !== prevD || c0 !== prevC0) {
    prevD = D; prevC0 = c0
    resetConc(c0)
    return
  }

  if (isPausing) {
    pauseTime += dt
    if (pauseTime >= PAUSE_DURATION) resetConc(c0)
    return
  }

  // Explicit finite differences, sub-stepped for stability (α = D·dt/dx² < 0.4)
  const simDt = dt * SPEED
  const numSteps = Math.max(1, Math.ceil(simDt * D / 0.4))
  const sDt = simDt / numSteps
  const alpha = D * sDt  // dx = 1

  for (let s = 0; s < numSteps; s++) {
    for (let i = 1; i < N - 1; i++) {
      next[i] = conc[i] + alpha * (conc[i - 1] - 2 * conc[i] + conc[i + 1])
    }
    next[0] = next[1]          // Neumann BC: no flux at walls
    next[N - 1] = next[N - 2]
    for (let i = 0; i < N; i++) conc[i] = next[i]
  }

  simTime += dt

  // Measure equilibration ratio = C_right / C_left
  let leftSum = 0, rightSum = 0
  const half = N >> 1
  for (let i = 0; i < half; i++) leftSum  += conc[i]
  for (let i = half; i < N; i++) rightSum += conc[i]
  const leftAvg  = leftSum  / half
  const rightAvg = rightSum / (N - half)
  const ratio = rightAvg / Math.max(leftAvg, 1e-9)

  if (!halfFired && ratio >= 0.5) {
    halfFired = true
    runtime.emit('half_equilibrium', {
      time_s: Math.round(simTime * 100) / 100,
      left_avg:  Math.round(leftAvg  * 1000) / 1000,
      right_avg: Math.round(rightAvg * 1000) / 1000,
    })
  }
  if (!nearFired && ratio >= 0.85) {
    nearFired = true
    isPausing = true
    pauseTime = 0
    runtime.emit('near_equilibrium', {
      time_s: Math.round(simTime * 100) / 100,
      left_avg:  Math.round(leftAvg  * 1000) / 1000,
      right_avg: Math.round(rightAvg * 1000) / 1000,
    })
  }
})

runtime.onRender(function(ctx) {
  const W = ctx.canvas.clientWidth  || ctx.canvas.width
  const H = ctx.canvas.clientHeight || ctx.canvas.height
  const PL = 20, PR = 20, PT = 44, GRAPH_H = 96, GAP = 12
  const chamberH = H - PT - GRAPH_H - GAP - 20
  const chamberW = W - PL - PR
  const cellW = chamberW / N
  const midX = PL + chamberW / 2
  const c0 = getC0()

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#f9fafb'
  ctx.fillRect(0, 0, W, H)

  // ── Chamber: colour cells by concentration ─────────────────────────────────
  for (let i = 0; i < N; i++) {
    const c = Math.max(0, Math.min(1, conc[i]))
    const x = PL + i * cellW
    // Light theme: white at c=0, deep blue at c=1
    const r  = Math.round(241 - c * 212)
    const g2 = Math.round(245 - c * 167)
    const b  = Math.round(249 - c * 33)
    ctx.fillStyle = `rgb(${r},${g2},${b})`
    ctx.fillRect(x, PT, cellW + 0.5, chamberH)
  }

  // Chamber border
  ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1.5
  ctx.strokeRect(PL, PT, chamberW, chamberH)

  // Membrane (centre dashed line)
  ctx.strokeStyle = '#374151'; ctx.lineWidth = 1.5
  ctx.setLineDash([5, 4])
  ctx.beginPath(); ctx.moveTo(midX, PT); ctx.lineTo(midX, PT + chamberH); ctx.stroke()
  ctx.setLineDash([])

  // Labels inside chamber
  ctx.font = '11px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.fillText('HIGH', PL + chamberW / 4,       PT + chamberH / 2)
  ctx.fillText('LOW',  PL + 3 * chamberW / 4,   PT + chamberH / 2)

  // Header row
  ctx.fillStyle = '#6b7280'; ctx.font = '10px monospace'; ctx.textAlign = 'left'
  ctx.fillText('membrane', midX - 32, PT - 6)
  ctx.textAlign = 'right'
  ctx.fillText(`D = ${getD().toFixed(2)}  ·  t = ${simTime.toFixed(1)} s`, W - PR, PT - 6)

  // ── Concentration profile graph ────────────────────────────────────────────
  const GL = PL, GT = PT + chamberH + GAP
  const GW = chamberW, GH = GRAPH_H
  const GB = GT + GH

  ctx.fillStyle = '#ffffff'; ctx.fillRect(GL, GT, GW, GH)
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.strokeRect(GL, GT, GW, GH)

  // Y-axis ticks and labels
  ctx.fillStyle = '#6b7280'; ctx.font = '9px monospace'; ctx.textAlign = 'right'
  for (let t = 0; t <= 1; t += 0.25) {
    const ty = GB - (t / 1) * GH
    ctx.fillText(t.toFixed(2), GL + 28, ty + 3)
    if (t > 0 && t < 1) {
      ctx.strokeStyle = '#f3f4f6'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(GL + 30, ty); ctx.lineTo(GL + GW, ty); ctx.stroke()
    }
  }

  // C0 reference dashed line
  const c0Y = GB - (c0 / 1.0) * GH
  ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1; ctx.setLineDash([3, 5])
  ctx.beginPath(); ctx.moveTo(GL + 30, c0Y); ctx.lineTo(GL + GW, c0Y); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#6b7280'; ctx.textAlign = 'right'; ctx.font = '9px monospace'
  ctx.fillText('C₀', GL + 28, c0Y + 3)

  // Profile curve
  ctx.strokeStyle = '#0891b2'; ctx.lineWidth = 2
  ctx.beginPath()
  for (let i = 0; i < N; i++) {
    const x = GL + (i / N) * GW
    const c = Math.max(0, Math.min(1, conc[i]))
    const y = GB - (c / 1.0) * GH
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Equilibration status bar at bottom of graph
  let leftSum = 0, rightSum = 0
  const half = N >> 1
  for (let i = 0; i < half; i++) leftSum  += conc[i]
  for (let i = half; i < N; i++) rightSum += conc[i]
  const leftAvg  = leftSum  / half
  const rightAvg = rightSum / (N - half)

  ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#6b7280'
  ctx.fillText(
    `C_left = ${leftAvg.toFixed(3)}   C_right = ${rightAvg.toFixed(3)}`,
    GL + GW / 2,
    GB + 14,
  )

  // Update region positions for overlay system
  rLeft     = { x: PL + chamberW / 4,       y: PT + chamberH / 2 }
  rRight    = { x: PL + 3 * chamberW / 4,   y: PT + chamberH / 2 }
  rGradient = { x: midX,                     y: PT + chamberH / 2 }
})
