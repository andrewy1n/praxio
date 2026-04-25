const G_RATE = runtime.registerParam('growth_rate', { label: 'Growth Rate (r)', min: 0.1, max: 2.5, default: 0.7, unit: '' })
const K_CAP = runtime.registerParam('carrying_capacity', { label: 'Carrying Capacity (K)', min: 100, max: 1000, default: 500, unit: '' })
const N0 = runtime.registerParam('initial_pop', { label: 'Starting Population', min: 5, max: 150, default: 30, unit: '' })

runtime.registerEvent('reached_inflection')
runtime.registerEvent('near_capacity')

const MAX_GEN = 25
let pops = []
let gen = 0
let simTime = 0
let pauseTime = 0
let isPausing = false
let inflectionFired = false
let capacityFired = false
let prevR = null, prevK = null, prevN = null

let px_start = { x: 80, y: 300 }
let px_inflection = { x: 200, y: 200 }
let px_capacity = { x: 400, y: 80 }

runtime.registerRegion('start_point', { getPosition: () => px_start })
runtime.registerRegion('inflection_point', { getPosition: () => px_inflection })
runtime.registerRegion('carrying_capacity_line', { getPosition: () => px_capacity })

function recompute(r, K, n0) {
  pops = [n0]
  for (let i = 1; i <= MAX_GEN; i++) {
    const N = pops[i - 1]
    pops.push(N + r * N * (1 - N / K))
  }
  gen = 0; simTime = 0; isPausing = false; pauseTime = 0
  inflectionFired = false; capacityFired = false
}

runtime.onUpdate(function (dt) {
  const r = G_RATE(), K = K_CAP(), n0 = N0()
  if (r !== prevR || K !== prevK || n0 !== prevN) {
    prevR = r; prevK = K; prevN = n0
    recompute(r, K, n0)
    return
  }
  if (isPausing) {
    pauseTime += dt
    if (pauseTime > 1.8) recompute(r, K, n0)
    return
  }
  simTime += dt
  if (simTime >= 0.38) {
    simTime -= 0.38
    if (gen < MAX_GEN) {
      gen++
      const N = pops[gen]
      if (!inflectionFired && N >= K / 2) {
        inflectionFired = true
        runtime.emit('reached_inflection', { generation: gen, population: Math.round(N) })
      }
      if (!capacityFired && N >= K * 0.95) {
        capacityFired = true
        runtime.emit('near_capacity', { generation: gen, population: Math.round(N) })
      }
    } else {
      isPausing = true; pauseTime = 0
    }
  }
})

runtime.onRender(function (ctx) {
  const W = ctx.canvas.clientWidth
  const H = ctx.canvas.clientHeight
  const PL = 72, PR = 30, PT = 40, PB = 52
  const pw = W - PL - PR, ph = H - PT - PB
  const K = K_CAP(), r = G_RATE()
  const maxY = K * 1.12

  function px(g, pop) {
    return { x: PL + (g / MAX_GEN) * pw, y: PT + ph - (pop / maxY) * ph }
  }

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, W, H)

  // K line
  const kY = PT + ph - (K / maxY) * ph
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4])
  ctx.beginPath(); ctx.moveTo(PL, kY); ctx.lineTo(W - PR, kY); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#ef4444'; ctx.font = '11px monospace'; ctx.textAlign = 'left'
  ctx.fillText('K = ' + K, W - PR - 56, kY - 5)
  px_capacity = { x: W - PR - 80, y: kY }

  // K/2 line
  const halfKY = PT + ph - (K / 2 / maxY) * ph
  ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1; ctx.setLineDash([3, 6]); ctx.globalAlpha = 0.45
  ctx.beginPath(); ctx.moveTo(PL, halfKY); ctx.lineTo(W - PR, halfKY); ctx.stroke()
  ctx.setLineDash([]); ctx.globalAlpha = 1
  ctx.fillStyle = '#f59e0b'; ctx.font = '10px monospace'
  ctx.fillText('K/2', PL + 4, halfKY - 3)

  // Axes
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(PL, PT); ctx.lineTo(PL, PT + ph); ctx.lineTo(PL + pw, PT + ph)
  ctx.stroke()

  // Y ticks
  ctx.fillStyle = '#666'; ctx.font = '10px monospace'; ctx.textAlign = 'right'
  for (let t = 0; t <= maxY; t += K / 4) {
    const ty = PT + ph - (t / maxY) * ph
    ctx.beginPath(); ctx.moveTo(PL - 4, ty); ctx.lineTo(PL, ty)
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke()
    ctx.fillText(Math.round(t), PL - 7, ty + 4)
  }

  // X ticks
  ctx.textAlign = 'center'
  for (let g = 0; g <= MAX_GEN; g += 5) {
    const tx = PL + (g / MAX_GEN) * pw
    ctx.beginPath(); ctx.moveTo(tx, PT + ph); ctx.lineTo(tx, PT + ph + 4)
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke()
    ctx.fillText(g, tx, PT + ph + 14)
  }

  // Axis labels
  ctx.fillStyle = '#888'; ctx.font = '11px monospace'; ctx.textAlign = 'center'
  ctx.fillText('Generation', PL + pw / 2, H - 8)
  ctx.save(); ctx.translate(14, PT + ph / 2); ctx.rotate(-Math.PI / 2)
  ctx.fillText('Population', 0, 0); ctx.restore()

  // Ghost full curve
  if (pops.length > 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1.5
    ctx.beginPath()
    pops.forEach((p, i) => { const pt = px(i, p); i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y) })
    ctx.stroke()
  }

  // Drawn curve
  if (gen > 0) {
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2.5
    ctx.beginPath()
    for (let i = 0; i <= gen && i < pops.length; i++) {
      const pt = px(i, pops[i]); i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)
    }
    ctx.stroke()
  }

  // Current dot
  const curPop = pops[gen] || 0
  const dot = px(gen, curPop)
  ctx.fillStyle = '#60a5fa'
  ctx.beginPath(); ctx.arc(dot.x, dot.y, 6, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#d4d4d4'; ctx.font = '11px monospace'; ctx.textAlign = 'left'
  ctx.fillText('Gen ' + gen + ': ' + Math.round(curPop), dot.x + 10, dot.y - 5)

  // Update region positions
  px_start = px(0, pops[0] || 0)
  let infGen = 0, minD = Infinity
  pops.forEach((p, i) => { const d = Math.abs(p - K / 2); if (d < minD) { minD = d; infGen = i } })
  px_inflection = px(infGen, pops[infGen] || K / 2)
})
