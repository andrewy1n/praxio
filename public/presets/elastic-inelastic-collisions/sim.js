// Matter renderer context has no drawing surface — create one manually
const canvas = document.createElement('canvas')
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%'
document.body.appendChild(canvas)
const ctx2d = canvas.getContext('2d')

function fit() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}
fit()
window.addEventListener('resize', () => { fit(); buildWorld() })

// ── Params ────────────────────────────────────────────────────────────────────
const getE  = runtime.registerParam('restitution', { label: 'Restitution (e)',     min: 0,    max: 1,   default: 1, unit: '', step: 0.05 })
const getMR = runtime.registerParam('mass_ratio',  { label: 'Mass Ratio (m₁/m₂)', min: 0.25, max: 4,   default: 1, unit: '' })

runtime.registerEvent('collision')
runtime.registerEvent('separation')

// ── Regions ───────────────────────────────────────────────────────────────────
let rLeft = { x: 100, y: 200 }, rRight = { x: 300, y: 200 }, rZone = { x: 200, y: 200 }
runtime.registerRegion('left_ball',      { getPosition: () => rLeft })
runtime.registerRegion('right_ball',     { getPosition: () => rRight })
runtime.registerRegion('collision_zone', { getPosition: () => rZone })

// ── Constants / state ─────────────────────────────────────────────────────────
const BASE_R  = 22    // radius of m₂ in px
const LAUNCH_V = 5    // px per Matter.js tick (≈ 300 px/s at 60 fps)
const POST_HOLD = 3.5 // seconds to display results before auto-reset

let M  = null         // { Matter, engine, world } — assigned on first onRender
let b1 = null, b2 = null
let active = false, collisionFired = false, postTime = 0
let ke0 = 0, p0 = 0  // pre-collision KE and momentum in sim units
let v1a = 0, v2a = 0, keF = 0  // post-collision: velocities normalised to v₀, KE fraction
let prevE = null, prevMR = null

// ── World builder — call whenever params change or episode resets ──────────────
function buildWorld() {
  if (!M) return
  const { Matter, engine, world } = M
  Matter.Events.off(engine)
  Matter.World.clear(world, false)
  engine.gravity.x = 0
  engine.gravity.y = 0

  const e = getE(), mr = getMR()
  const W = canvas.width, H = canvas.height
  const tY = H * 0.5
  const r1 = BASE_R * Math.cbrt(mr)  // radius scales with cube-root of mass

  b1 = Matter.Bodies.circle(W * 0.22, tY, r1, {
    mass: mr, restitution: e, friction: 0, frictionAir: 0, frictionStatic: 0,
  })
  b2 = Matter.Bodies.circle(W * 0.62, tY, BASE_R, {
    mass: 1, restitution: e, friction: 0, frictionAir: 0, frictionStatic: 0,
  })
  Matter.World.add(world, [b1, b2])
  active = false; collisionFired = false; postTime = 0

  // Capture post-collision state on first contact
  Matter.Events.on(engine, 'collisionStart', function(ev) {
    if (collisionFired || !active) return
    for (const pair of ev.pairs) {
      if ((pair.bodyA === b1 && pair.bodyB === b2) || (pair.bodyA === b2 && pair.bodyB === b1)) {
        collisionFired = true; postTime = 0
        const mr2 = getMR()
        // Velocities are post-impulse at this point (Matter resolves before firing)
        v1a = b1.velocity.x / LAUNCH_V
        v2a = b2.velocity.x / LAUNCH_V
        const ke1 = 0.5 * mr2 * b1.velocity.x * b1.velocity.x + 0.5 * b2.velocity.x * b2.velocity.x
        keF = ke0 > 0 ? ke1 / ke0 : 0

        runtime.emit('collision', {
          ke_before: Math.round(ke0 * 1e3) / 1e3,
          p_before:  Math.round(p0  * 1e3) / 1e3,
        })
        runtime.emit('separation', {
          v1_after:    Math.round(v1a * 1e3) / 1e3,
          v2_after:    Math.round(v2a * 1e3) / 1e3,
          ke_fraction: Math.round(keF * 1e3) / 1e3,
        })
        break
      }
    }
  })

  prevE = e; prevMR = mr
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
runtime.onLaunch(function() {
  if (!M || !b1) return
  const mr = getMR()
  ke0 = 0.5 * mr * LAUNCH_V * LAUNCH_V
  p0  = mr * LAUNCH_V
  M.Matter.Body.setVelocity(b1, { x: LAUNCH_V, y: 0 })
  active = true; collisionFired = false; postTime = 0
})

runtime.onReset(function() { buildWorld() })

runtime.onUpdate(function(dt) {
  if (getE() !== prevE || getMR() !== prevMR) { buildWorld(); return }
  if (!M || !b1 || !active) return
  M.Matter.Engine.update(M.engine, dt * 1000)
  if (collisionFired) {
    postTime += dt
    if (postTime >= POST_HOLD) {
      active = false
      runtime.reportPhase('done')
      buildWorld()
    }
  }
})

// ── Render ────────────────────────────────────────────────────────────────────
runtime.onRender(function(ctx) {
  // ctx = { Matter, engine, world } — save on first call, then draw on ctx2d
  if (!M) { M = ctx; buildWorld() }
  if (!b1 || !b2) return

  const W  = canvas.width, H = canvas.height
  const tY = H * 0.5
  const e  = getE(), mr = getMR()
  const r1 = BASE_R * Math.cbrt(mr)
  const x1 = b1.position.x, y1 = b1.position.y
  const x2 = b2.position.x, y2 = b2.position.y

  // Background
  ctx2d.fillStyle = '#f9fafb'
  ctx2d.fillRect(0, 0, W, H)

  // Track rail and end stops
  const railY = tY + Math.max(r1, BASE_R) + 10
  ctx2d.strokeStyle = '#d1d5db'; ctx2d.lineWidth = 2
  ctx2d.beginPath(); ctx2d.moveTo(48, railY); ctx2d.lineTo(W - 48, railY); ctx2d.stroke()
  ctx2d.strokeStyle = '#9ca3af'; ctx2d.lineWidth = 6
  ctx2d.beginPath(); ctx2d.moveTo(48, tY - r1 - 14); ctx2d.lineTo(48, railY); ctx2d.stroke()
  ctx2d.beginPath(); ctx2d.moveTo(W - 48, tY - BASE_R - 14); ctx2d.lineTo(W - 48, railY); ctx2d.stroke()

  // Draw a ball: glow → body → specular highlight
  function drawBall(x, y, r, color, spec) {
    ctx2d.beginPath(); ctx2d.arc(x, y, r + 10, 0, Math.PI * 2)
    ctx2d.fillStyle = color + '18'; ctx2d.fill()
    ctx2d.beginPath(); ctx2d.arc(x, y, r, 0, Math.PI * 2)
    ctx2d.fillStyle = color; ctx2d.fill()
    ctx2d.beginPath(); ctx2d.arc(x - r * 0.28, y - r * 0.28, r * 0.30, 0, Math.PI * 2)
    ctx2d.fillStyle = spec; ctx2d.fill()
  }
  drawBall(x2, y2, BASE_R, '#f97316', 'rgba(255,210,160,0.45)')
  drawBall(x1, y1, r1,     '#60a5fa', 'rgba(200,225,255,0.45)')

  // Ball labels
  ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle'; ctx2d.fillStyle = '#fff'
  ctx2d.font = `bold ${Math.max(10, Math.round(r1 * 0.55))}px monospace`
  ctx2d.fillText('m₁', x1, y1)
  ctx2d.font = 'bold 11px monospace'
  ctx2d.fillText('m₂', x2, y2)

  // Velocity arrow above a ball (vNorm = velocity / LAUNCH_V)
  function drawArrow(x, y, r, vNorm, color) {
    const SCALE = 62
    const len = vNorm * SCALE
    if (Math.abs(len) < 4) return
    const ay = y - r - 20
    ctx2d.strokeStyle = color; ctx2d.lineWidth = 2.5
    ctx2d.beginPath(); ctx2d.moveTo(x, ay); ctx2d.lineTo(x + len, ay); ctx2d.stroke()
    const dir = len > 0 ? 1 : -1
    ctx2d.beginPath()
    ctx2d.moveTo(x + len, ay)
    ctx2d.lineTo(x + len - dir * 8, ay - 5)
    ctx2d.lineTo(x + len - dir * 8, ay + 5)
    ctx2d.closePath()
    ctx2d.fillStyle = color; ctx2d.fill()
    ctx2d.font = '10px monospace'; ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'bottom'
    ctx2d.fillStyle = color
    ctx2d.fillText((vNorm >= 0 ? '+' : '') + vNorm.toFixed(2) + ' v₀', x + len / 2, ay - 3)
  }

  if (active) {
    drawArrow(x1, y1, r1, b1.velocity.x / LAUNCH_V, '#60a5fa')
    if (Math.abs(b2.velocity.x) > LAUNCH_V * 0.04) {
      drawArrow(x2, y2, BASE_R, b2.velocity.x / LAUNCH_V, '#f97316')
    }
  }

  // Elastic / inelastic label — top-left
  const eLabel = e >= 0.95 ? 'ELASTIC' : e <= 0.05 ? 'PERFECTLY INELASTIC' : 'INELASTIC'
  const eColor = e >= 0.95 ? '#4ade80' : e <= 0.05 ? '#f87171' : '#fbbf24'
  ctx2d.font = 'bold 11px monospace'; ctx2d.textAlign = 'left'; ctx2d.textBaseline = 'top'
  ctx2d.fillStyle = eColor
  ctx2d.fillText(eLabel, 20, 16)

  // Param summary — top-right
  ctx2d.font = '11px monospace'; ctx2d.textAlign = 'right'
  ctx2d.fillStyle = '#9ca3af'
  ctx2d.fillText(`e = ${e.toFixed(2)}   m₁/m₂ = ${mr.toFixed(2)}`, W - 20, 16)

  // Post-collision results panel
  if (collisionFired) {
    const pw = 280, ph = 98
    const px = W / 2 - pw / 2, py = railY + 16
    ctx2d.fillStyle = 'rgba(255,255,255,0.95)'
    ctx2d.beginPath()
    ctx2d.roundRect(px, py, pw, ph, 6)
    ctx2d.fill()
    ctx2d.strokeStyle = '#e5e7eb'; ctx2d.lineWidth = 1
    ctx2d.beginPath(); ctx2d.roundRect(px, py, pw, ph, 6); ctx2d.stroke()

    const keColor = keF > 0.94 ? '#16a34a' : keF > 0.6 ? '#d97706' : '#dc2626'
    const rows = [
      ['KE conserved:',       (keF * 100).toFixed(1) + '%',                   keColor ],
      ['Momentum conserved:', '~100%',                                         '#16a34a'],
      ['v₁ after:',           (v1a >= 0 ? '+' : '') + v1a.toFixed(2) + ' v₀', '#2563eb'],
      ['v₂ after:',           '+' + v2a.toFixed(2) + ' v₀',                   '#ea580c'],
    ]
    ctx2d.font = '11px monospace'; ctx2d.textBaseline = 'alphabetic'
    rows.forEach(function([label, value, color], i) {
      const ry = py + 22 + i * 20
      ctx2d.textAlign = 'left';  ctx2d.fillStyle = '#6b7280'; ctx2d.fillText(label, px + 16, ry)
      ctx2d.textAlign = 'right'; ctx2d.fillStyle = color;     ctx2d.fillText(value, px + pw - 16, ry)
    })
  }

  // Pre-launch prompt
  if (!active && !collisionFired) {
    ctx2d.font = '12px monospace'; ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'top'
    ctx2d.fillStyle = '#9ca3af'
    ctx2d.fillText('Press Launch →', W / 2, railY + 16)
  }

  // Update region positions for annotation system
  rLeft  = { x: x1, y: y1 }
  rRight = { x: x2, y: y2 }
  rZone  = { x: (x1 + x2) / 2, y: tY }
})
