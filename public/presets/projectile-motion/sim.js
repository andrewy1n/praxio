const G = 9.8
const SCALE = 8
const LAUNCH_X_PX = 72

/** Sim canvas / illustration — planning/design/tokens.md (canvas wash + dot grid) */
const SKY_WASH = [250, 250, 248] /* #fafaf8 */
const DOT_GRID = [212, 212, 204] /* #d4d4cc */
const DOT_GRID_STEP = 24 /* px cell, 1px dot */

/** Cannon / illustration palette — planning/design/tokens.md */
const INK = [17, 17, 16]                /* --ink  #111110 */
const INK_2 = [85, 85, 82]              /* --ink2 #555552 */
const INK_3 = [153, 153, 148]           /* --ink3 #999994 */
const DIAGRAM_STROKE = [184, 184, 176]  /* #b8b8b0 (muted diagram stroke) */
const SURFACE = [249, 249, 249]         /* --surface #f9f9f9 (near-white highlight) */
const ACCENT_BLUE = [0, 110, 164]       /* --accent oklch(50% 0.14 232) */
const YELLOW = [208, 155, 33]           /* --yellow oklch(72% 0.14 82) */
const YELLOW_LIGHT = [255, 240, 212]    /* --yellow-light oklch(96% 0.04 82) */

let _skyGraphics = null
let _skyGraphicsKey = ''

const getAngle = runtime.registerParam('angle', { label: 'Launch Angle', min: 5, max: 85, default: 45, unit: '°' })
const getSpeed = runtime.registerParam('speed', { label: 'Initial Speed', min: 5, max: 50, default: 25, unit: 'm/s' })

runtime.registerEvent('launched')
runtime.registerEvent('landed')

let active = false
let simTime = 0
let flightTime = 0
let rangeM = 0
let _groundY = 0
const trail = []

function getGroundY() { return _groundY || 400 }

function computeTrajectory(speed, angle_deg) {
  const a = angle_deg * Math.PI / 180
  const T = (2 * speed * Math.sin(a)) / G
  return { T, R: speed * Math.cos(a) * T }
}

runtime.registerRegion('launch_point', { getPosition: () => ({ x: LAUNCH_X_PX, y: getGroundY() }) })
runtime.registerRegion('peak_trajectory', {
  getPosition: () => {
    const a = getAngle() * Math.PI / 180
    const vy = getSpeed() * Math.sin(a), vx = getSpeed() * Math.cos(a)
    const tApex = vy / G
    return { x: LAUNCH_X_PX + vx * tApex * SCALE, y: getGroundY() - (vy * tApex - 0.5 * G * tApex * tApex) * SCALE }
  }
})
runtime.registerRegion('landing_point', {
  getPosition: () => {
    const { T } = computeTrajectory(getSpeed(), getAngle())
    return { x: LAUNCH_X_PX + getSpeed() * Math.cos(getAngle() * Math.PI / 180) * T * SCALE, y: getGroundY() }
  }
})

runtime.onLaunch(function() {
  const traj = computeTrajectory(getSpeed(), getAngle())
  flightTime = traj.T; rangeM = traj.R; simTime = 0; active = true
  trail.length = 0
  runtime.emit('launched', {})
})

runtime.onReset(function() {
  active = false; simTime = 0; rangeM = 0; trail.length = 0
})

runtime.onUpdate(function(dt) {
  if (!active) return
  simTime += dt
  if (simTime >= flightTime) {
    simTime = flightTime; active = false
    runtime.reportPhase('done')
    runtime.emit('landed', { range_m: Math.round(rangeM * 10) / 10, time_of_flight_s: Math.round(flightTime * 10) / 10 })
  }
})

runtime.onRender(function(p) {
  // Baseline: slightly higher so the cannon / landing sit up a bit.
  _groundY = p.height * 0.88
  const groundY = _groundY
  // Visual offset to align rendered trajectory with the muzzle tip.
  // Physics origin is (LAUNCH_X_PX, groundY); muzzle tip is 18px above.
  // Applied only at render sites that depend on trajectory — physics untouched.
  const LAUNCH_Y_OFFSET = -18
  const angle_deg = getAngle(), speed = getSpeed()
  const angle = angle_deg * Math.PI / 180
  const vx = speed * Math.cos(angle), vy = speed * Math.sin(angle)
  const { T } = computeTrajectory(speed, angle_deg)

  // Sky: canvas wash + 24×24 dot grid (tokens.md — not the old dark gradient)
  const skyH = Math.max(1, Math.ceil(groundY))
  const skyKey = `${p.width | 0},${skyH}`
  if (!_skyGraphics || _skyGraphicsKey !== skyKey) {
    _skyGraphics = p.createGraphics(p.width, skyH)
    _skyGraphicsKey = skyKey
    _skyGraphics.noStroke()
    _skyGraphics.background(SKY_WASH[0], SKY_WASH[1], SKY_WASH[2])
    _skyGraphics.fill(DOT_GRID[0], DOT_GRID[1], DOT_GRID[2])
    for (let x = 0; x <= _skyGraphics.width; x += DOT_GRID_STEP) {
      for (let y = 0; y <= _skyGraphics.height; y += DOT_GRID_STEP) {
        _skyGraphics.rect(x, y, 1, 1)
      }
    }
  }
  p.image(_skyGraphics, 0, 0)

  // Ground: match the sim canvas background (no dark green band).
  // Keep a subtle baseline using the mock's muted diagram stroke.
  p.noStroke()
  p.fill(SKY_WASH[0], SKY_WASH[1], SKY_WASH[2])
  p.rect(0, groundY, p.width, p.height - groundY)

  // Baseline (muted)
  p.stroke(DIAGRAM_STROKE[0], DIAGRAM_STROKE[1], DIAGRAM_STROKE[2], 180)
  p.strokeWeight(1.5)
  p.line(0, groundY, p.width, groundY)

  // Subtle distance grid lines
  p.stroke(DIAGRAM_STROKE[0], DIAGRAM_STROKE[1], DIAGRAM_STROKE[2], 60)
  p.strokeWeight(1)
  for (let gx = 120; gx < p.width; gx += 80) {
    p.line(gx, groundY - 6, gx, groundY + 4)
  }

  // ─── Cannon rendering ────────────────────────────────────────────────
  // Visual barrel pivot sits at (LAUNCH_X_PX, groundY - 18) while physics
  // launch origin is at (LAUNCH_X_PX, groundY). LAUNCH_Y_OFFSET (declared
  // at the top of onRender) bridges this via a tapered per-frame Y offset
  // applied to the ball, trail, and completed arc — offset is -18px at
  // t=0 (muzzle tip) and 0 at t=T (ball touches down on the ground line).
  // Physics formulas and region positions are untouched.
  const px = -Math.sin(angle), py = -Math.cos(angle)  // unit top-normal (screen coords)

  // Carriage — classic cheek silhouette in INK (bezier-curved front + back tail curl)
  const carriageBottomY = groundY - 4
  const carriageH = 14
  const carriageTopY = carriageBottomY - carriageH
  p.fill(INK[0], INK[1], INK[2]); p.noStroke()
  p.beginShape()
  p.vertex(LAUNCH_X_PX - 14, carriageTopY)                // top-left
  p.vertex(LAUNCH_X_PX + 14, carriageTopY)                // top-right
  p.bezierVertex(                                         // front face bows outward
    LAUNCH_X_PX + 18, carriageTopY + 4,
    LAUNCH_X_PX + 18, carriageBottomY - 5,
    LAUNCH_X_PX + 18, carriageBottomY - 2
  )
  p.vertex(LAUNCH_X_PX + 18, carriageBottomY)             // front-bottom
  p.vertex(LAUNCH_X_PX - 16, carriageBottomY)             // bottom-left
  p.bezierVertex(                                         // back curls out into tail
    LAUNCH_X_PX - 20, carriageBottomY - 1,
    LAUNCH_X_PX - 22, carriageBottomY - 3,
    LAUNCH_X_PX - 22, carriageBottomY - 4
  )
  p.bezierVertex(                                         // back face curves up to top-left
    LAUNCH_X_PX - 22, carriageTopY + 6,
    LAUNCH_X_PX - 18, carriageTopY + 2,
    LAUNCH_X_PX - 14, carriageTopY
  )
  p.endShape(p.CLOSE)

  // Top-edge highlight for definition where barrel rests
  p.stroke(INK_2[0], INK_2[1], INK_2[2]); p.strokeWeight(1); p.noFill()
  p.line(LAUNCH_X_PX - 14, carriageTopY, LAUNCH_X_PX + 14, carriageTopY)

  // Spoked wheels — outer INK ring (no fill), 6 INK_2 spokes, INK hub
  // Dot grid shows through between spokes — the editorial touch
  for (const wx of [LAUNCH_X_PX - 12, LAUNCH_X_PX + 12]) {
    p.push()
    p.translate(wx, groundY - 8)
    p.noFill(); p.stroke(INK[0], INK[1], INK[2]); p.strokeWeight(2.5)
    p.circle(0, 0, 22)
    p.stroke(INK_2[0], INK_2[1], INK_2[2]); p.strokeWeight(1.5)
    for (let i = 0; i < 6; i++) {
      p.line(3, 0, 10, 0)
      p.rotate(Math.PI / 3)
    }
    p.noStroke(); p.fill(INK[0], INK[1], INK[2])
    p.circle(0, 0, 6)
    p.pop()
  }

  // Trunnions — pivot bolts flanking the barrel breech, nested at the pivot
  p.fill(INK_2[0], INK_2[1], INK_2[2])
  p.stroke(INK_3[0], INK_3[1], INK_3[2]); p.strokeWeight(1)
  p.circle(LAUNCH_X_PX + 4 * px, carriageTopY + 4 * py, 5)
  p.circle(LAUNCH_X_PX - 4 * px, carriageTopY - 4 * py, 5)

  // Tapered barrel — 13px breech → 9px muzzle, INK fill (top-normal = (px, py))
  const bx2 = LAUNCH_X_PX + Math.cos(angle) * 38
  const by2 = carriageTopY - Math.sin(angle) * 38
  p.fill(INK[0], INK[1], INK[2]); p.noStroke()
  p.beginShape()
  p.vertex(LAUNCH_X_PX + 6.5 * px, carriageTopY + 6.5 * py)  // breech-top
  p.vertex(bx2 + 4.5 * px, by2 + 4.5 * py)                   // muzzle-top
  p.vertex(bx2 - 4.5 * px, by2 - 4.5 * py)                   // muzzle-bot
  p.vertex(LAUNCH_X_PX - 6.5 * px, carriageTopY - 6.5 * py)  // breech-bot
  p.endShape(p.CLOSE)

  // Barrel top-edge highlight — 2px SURFACE, inset 1.5px from top edge
  p.stroke(SURFACE[0], SURFACE[1], SURFACE[2]); p.strokeWeight(2); p.noFill()
  p.line(
    LAUNCH_X_PX + 5 * px, carriageTopY + 5 * py,
    bx2 + 3 * px, by2 + 3 * py
  )

  // Reinforcement bands at 35% and 70% of barrel length (2.5px INK_2 perpendicular)
  p.stroke(INK_2[0], INK_2[1], INK_2[2]); p.strokeWeight(2.5); p.noFill()
  for (const { t, halfLen } of [{ t: 13.3, halfLen: 7.8 }, { t: 26.6, halfLen: 7.1 }]) {
    const bandX = LAUNCH_X_PX + Math.cos(angle) * t
    const bandY = carriageTopY - Math.sin(angle) * t
    p.push()
    p.translate(bandX, bandY)
    p.rotate(-angle)
    p.line(0, -halfLen, 0, halfLen)
    p.pop()
  }

  // Muzzle flare — filled INK_2 lip at barrel tip, perpendicular to barrel
  p.push()
  p.translate(bx2, by2)
  p.rotate(-angle)
  p.fill(INK_2[0], INK_2[1], INK_2[2]); p.noStroke()
  p.ellipse(0, 0, 5, 13)
  p.pop()

  // Launch direction indicator (only shown pre-launch) — origin at carriage pivot
  if (!active && simTime === 0) {
    const arrowLen = 48
    const ax = LAUNCH_X_PX + Math.cos(angle) * arrowLen
    const ay = carriageTopY - Math.sin(angle) * arrowLen
    p.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 120); p.strokeWeight(1.5)
    p.line(LAUNCH_X_PX, carriageTopY, ax, ay)
    // Arrow head
    const headLen = 7
    const headAngle1 = angle + 2.6
    const headAngle2 = angle - 2.6
    p.line(ax, ay, ax - Math.cos(headAngle1) * headLen, ay + Math.sin(headAngle1) * headLen)
    p.line(ax, ay, ax - Math.cos(headAngle2) * headLen, ay + Math.sin(headAngle2) * headLen)
  }

  // Trail dots — Y bakes in the tapered LAUNCH_Y_OFFSET at push time
  if (active) {
    const trailOffset = flightTime > 0 ? LAUNCH_Y_OFFSET * (1 - simTime / flightTime) : LAUNCH_Y_OFFSET
    const ballX = LAUNCH_X_PX + vx * simTime * SCALE
    const ballY = groundY + trailOffset - (vy * simTime - 0.5 * G * simTime * simTime) * SCALE
    if (trail.length === 0 || p.dist(ballX, ballY, trail[trail.length - 1].x, trail[trail.length - 1].y) > 6) {
      trail.push({ x: ballX, y: ballY })
    }
  }
  for (let i = 0; i < trail.length; i++) {
    const alpha = p.map(i, 0, trail.length, 20, 120)
    const sz = p.map(i, 0, trail.length, 2, 6)
    p.noStroke(); p.fill(ACCENT_BLUE[0], ACCENT_BLUE[1], ACCENT_BLUE[2], alpha)
    p.circle(trail[i].x, trail[i].y, sz)
  }

  // Completed arc (shown after landing) — per-vertex offset tapers to 0 at ti=T
  if (!active && simTime > 0) {
    p.stroke(ACCENT_BLUE[0], ACCENT_BLUE[1], ACCENT_BLUE[2], 55); p.strokeWeight(1.5); p.noFill()
    p.beginShape()
    for (let ti = 0; ti <= T; ti += T / 80) {
      const v_offset = LAUNCH_Y_OFFSET * (1 - ti / T)
      p.vertex(LAUNCH_X_PX + vx * ti * SCALE, groundY + v_offset - (vy * ti - 0.5 * G * ti * ti) * SCALE)
    }
    p.vertex(LAUNCH_X_PX + vx * T * SCALE, groundY)
    p.endShape()
  }

  // Ball — sit at muzzle tip pre-launch, fly during active, stay at landing after done
  const ct = simTime
  let ballX, ballY
  if (!active && simTime === 0) {
    ballX = LAUNCH_X_PX + Math.cos(angle) * 44
    ballY = carriageTopY - Math.sin(angle) * 44
  } else {
    // Tapered offset: -18 at launch → 0 at landing (ball rises from muzzle,
    // lands cleanly on the ground line).
    const ballOffset = flightTime > 0 ? LAUNCH_Y_OFFSET * (1 - ct / flightTime) : LAUNCH_Y_OFFSET
    ballX = LAUNCH_X_PX + vx * ct * SCALE
    ballY = groundY + ballOffset - (vy * ct - 0.5 * G * ct * ct) * SCALE
  }
  // Glow
  p.noStroke(); p.fill(ACCENT_BLUE[0], ACCENT_BLUE[1], ACCENT_BLUE[2], 30)
  p.circle(ballX, ballY, 30)
  p.fill(ACCENT_BLUE[0], ACCENT_BLUE[1], ACCENT_BLUE[2], 60)
  p.circle(ballX, ballY, 20)
  // Ball body
  p.fill(ACCENT_BLUE[0], ACCENT_BLUE[1], ACCENT_BLUE[2]); p.noStroke()
  p.circle(ballX, ballY, 13)
  // Highlight
  p.fill(SURFACE[0], SURFACE[1], SURFACE[2], 220)
  p.circle(ballX - 2, ballY - 2, 5)

  // Landing marker
  if (!active && simTime > 0) {
    const landingX = LAUNCH_X_PX + vx * T * SCALE
    p.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 180); p.strokeWeight(1.5)
    p.line(landingX - 8, groundY - 4, landingX + 8, groundY - 4)
    p.line(landingX, groundY - 10, landingX, groundY + 2)
    // Range label with background
    const midX = (LAUNCH_X_PX + landingX) / 2
    p.noStroke(); p.fill(INK[0], INK[1], INK[2], 220)
    p.rect(midX - 54, groundY - 26, 108, 18, 4)
    p.fill(YELLOW[0], YELLOW[1], YELLOW[2]); p.noStroke(); p.textSize(11); p.textAlign(p.CENTER)
    p.text('Range: ' + rangeM.toFixed(1) + ' m', midX, groundY - 13)
  }

  // Angle / speed HUD
  const hudX = LAUNCH_X_PX + 46, hudY = groundY - 24
  p.noStroke(); p.fill(INK[0], INK[1], INK[2], 210)
  p.rect(hudX - 4, hudY - 13, 112, 18, 3)
  p.fill(INK_3[0], INK_3[1], INK_3[2]); p.noStroke(); p.textAlign(p.LEFT); p.textSize(11)
  p.text(angle_deg.toFixed(1) + '°  ·  ' + speed.toFixed(0) + ' m/s', hudX, hudY)
})
