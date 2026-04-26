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
const ARROW_VX = [220, 100, 40]         /* horizontal component — warm orange */
const ARROW_VY = [60, 180, 100]         /* vertical component — green */

let _skyGraphics = null
let _skyGraphicsKey = ''

const getAngle    = runtime.registerParam('launch_angle',     { label: 'Launch Angle',    min: 5,  max: 85, default: 30,  unit: '°'    })
const getVelocity = runtime.registerParam('initial_velocity', { label: 'Initial Velocity', min: 5,  max: 50, default: 20,  unit: 'm/s'  })
const getGravity  = runtime.registerParam('gravity',          { label: 'Gravity',          min: 1,  max: 20, default: 9.8, unit: 'm/s²' })

runtime.registerEvent('launched')
runtime.registerEvent('landed')

let active = false
let simTime = 0
let traj = null
let ghostTraj = null
let _groundY = 0
const trail = []

function getGroundY() { return _groundY || 400 }

function makeTraj() {
  return runtime.physics.projectile(getVelocity(), getAngle(), getGravity())
}

runtime.registerRegion('launch', {
  getPosition: () => ({ x: LAUNCH_X_PX, y: getGroundY() }),
})
runtime.registerRegion('apex', {
  getPosition: () => {
    const tr = makeTraj()
    const pos = tr.positionAt(tr.peak.t)
    return { x: LAUNCH_X_PX + pos.x_m * SCALE, y: getGroundY() - pos.y_m * SCALE }
  },
})
runtime.registerRegion('landing', {
  getPosition: () => {
    const tr = makeTraj()
    return { x: LAUNCH_X_PX + tr.range * SCALE, y: getGroundY() }
  },
})

function drawArrow(p, x1, y1, x2, y2, col) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 4) return
  p.stroke(col[0], col[1], col[2]); p.strokeWeight(2)
  p.line(x1, y1, x2, y2)
  const headLen = 7
  const a = Math.atan2(dy, dx)
  p.noStroke(); p.fill(col[0], col[1], col[2])
  p.triangle(
    x2, y2,
    x2 - headLen * Math.cos(a - 0.4), y2 - headLen * Math.sin(a - 0.4),
    x2 - headLen * Math.cos(a + 0.4), y2 - headLen * Math.sin(a + 0.4)
  )
}

runtime.onLaunch(function () {
  if (traj && !active && simTime > 0) ghostTraj = traj
  traj = makeTraj()
  simTime = 0
  active = true
  trail.length = 0
  runtime.emit('launched', {})
})

runtime.onReset(function () {
  active = false; simTime = 0; traj = null; ghostTraj = null; trail.length = 0
})

runtime.onUpdate(function (dt) {
  if (!active || !traj) return
  simTime += dt
  if (traj.didLand(simTime)) {
    simTime = traj.flightTime
    active = false
    runtime.reportPhase('done')
    runtime.emit('landed', {
      range_m: Math.round(traj.range * 10) / 10,
      time_of_flight_s: Math.round(traj.flightTime * 10) / 10,
      angle: getAngle(),
    })
  }
})

runtime.onRender(function (p) {
  _groundY = p.height * 0.88
  const groundY = _groundY
  const LAUNCH_Y_OFFSET = -18
  const angle_deg = getAngle()
  const speed = getVelocity()
  const angle = angle_deg * Math.PI / 180
  const trPreview = makeTraj()
  const arcTr = traj || trPreview
  const T = arcTr.flightTime

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

  p.noStroke()
  p.fill(SKY_WASH[0], SKY_WASH[1], SKY_WASH[2])
  p.rect(0, groundY, p.width, p.height - groundY)
  p.stroke(DIAGRAM_STROKE[0], DIAGRAM_STROKE[1], DIAGRAM_STROKE[2], 180)
  p.strokeWeight(1.5)
  p.line(0, groundY, p.width, groundY)

  p.stroke(DIAGRAM_STROKE[0], DIAGRAM_STROKE[1], DIAGRAM_STROKE[2], 60)
  p.strokeWeight(1)
  for (let gx = 120; gx < p.width; gx += 80) {
    p.line(gx, groundY - 6, gx, groundY + 4)
  }

  // Ghost arc (previous flight for comparison)
  if (ghostTraj) {
    const ghostT = ghostTraj.flightTime
    p.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 50); p.strokeWeight(1.5); p.noFill()
    p.beginShape()
    for (let ti = 0; ti <= ghostT; ti += ghostT / 80) {
      const pos = ghostTraj.positionAt(ti)
      const vOffset = ghostT > 0 ? LAUNCH_Y_OFFSET * (1 - ti / ghostT) : LAUNCH_Y_OFFSET
      p.vertex(LAUNCH_X_PX + pos.x_m * SCALE, groundY + vOffset - pos.y_m * SCALE)
    }
    p.vertex(LAUNCH_X_PX + ghostTraj.range * SCALE, groundY)
    p.endShape()
    const glX = LAUNCH_X_PX + ghostTraj.range * SCALE
    p.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 100); p.strokeWeight(1.5)
    p.line(glX - 6, groundY - 4, glX + 6, groundY - 4)
    p.line(glX, groundY - 9, glX, groundY + 2)
  }

  const carriageTopY = groundY - 18
  const px = -Math.sin(angle)
  const py = -Math.cos(angle)

  // Carriage body
  const carriageBottomY = groundY - 4
  const carriageH = 14
  p.fill(INK[0], INK[1], INK[2]); p.noStroke()
  p.beginShape()
  p.vertex(LAUNCH_X_PX - 14, carriageBottomY - carriageH)
  p.vertex(LAUNCH_X_PX + 14, carriageBottomY - carriageH)
  p.bezierVertex(LAUNCH_X_PX + 18, carriageBottomY - carriageH + 4, LAUNCH_X_PX + 18, carriageBottomY - 5, LAUNCH_X_PX + 18, carriageBottomY - 2)
  p.vertex(LAUNCH_X_PX + 18, carriageBottomY)
  p.vertex(LAUNCH_X_PX - 16, carriageBottomY)
  p.bezierVertex(LAUNCH_X_PX - 20, carriageBottomY - 1, LAUNCH_X_PX - 22, carriageBottomY - 3, LAUNCH_X_PX - 22, carriageBottomY - 4)
  p.bezierVertex(LAUNCH_X_PX - 22, carriageBottomY - carriageH + 6, LAUNCH_X_PX - 18, carriageBottomY - carriageH + 2, LAUNCH_X_PX - 14, carriageBottomY - carriageH)
  p.endShape(p.CLOSE)
  p.stroke(INK_2[0], INK_2[1], INK_2[2]); p.strokeWeight(1); p.noFill()
  p.line(LAUNCH_X_PX - 14, carriageBottomY - carriageH, LAUNCH_X_PX + 14, carriageBottomY - carriageH)

  // Wheels
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

  // Trunnions
  p.fill(INK_2[0], INK_2[1], INK_2[2])
  p.stroke(INK_3[0], INK_3[1], INK_3[2]); p.strokeWeight(1)
  p.circle(LAUNCH_X_PX + 4 * px, carriageTopY + 4 * py, 5)
  p.circle(LAUNCH_X_PX - 4 * px, carriageTopY - 4 * py, 5)

  // Barrel
  const bx2 = LAUNCH_X_PX + Math.cos(angle) * 38
  const by2 = carriageTopY - Math.sin(angle) * 38
  p.fill(INK[0], INK[1], INK[2]); p.noStroke()
  p.beginShape()
  p.vertex(LAUNCH_X_PX + 6.5 * px, carriageTopY + 6.5 * py)
  p.vertex(bx2 + 4.5 * px, by2 + 4.5 * py)
  p.vertex(bx2 - 4.5 * px, by2 - 4.5 * py)
  p.vertex(LAUNCH_X_PX - 6.5 * px, carriageTopY - 6.5 * py)
  p.endShape(p.CLOSE)
  p.stroke(SURFACE[0], SURFACE[1], SURFACE[2]); p.strokeWeight(2); p.noFill()
  p.line(LAUNCH_X_PX + 5 * px, carriageTopY + 5 * py, bx2 + 3 * px, by2 + 3 * py)
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
  p.push()
  p.translate(bx2, by2)
  p.rotate(-angle)
  p.fill(INK_2[0], INK_2[1], INK_2[2]); p.noStroke()
  p.ellipse(0, 0, 5, 13)
  p.pop()

  // Launch direction arrow (pre-launch idle state)
  if (!active && simTime === 0) {
    const arrowLen = 48
    const ax = LAUNCH_X_PX + Math.cos(angle) * arrowLen
    const ay = carriageTopY - Math.sin(angle) * arrowLen
    p.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 120); p.strokeWeight(1.5)
    p.line(LAUNCH_X_PX, carriageTopY, ax, ay)
    const headLen = 7
    p.line(ax, ay, ax - Math.cos(angle + 2.6) * headLen, ay + Math.sin(angle + 2.6) * headLen)
    p.line(ax, ay, ax - Math.cos(angle - 2.6) * headLen, ay + Math.sin(angle - 2.6) * headLen)
  }

  // Trail dots
  if (active && traj) {
    const pos = traj.positionAt(simTime)
    const trailOffset = T > 0 ? LAUNCH_Y_OFFSET * (1 - simTime / T) : LAUNCH_Y_OFFSET
    const bx = LAUNCH_X_PX + pos.x_m * SCALE
    const by = groundY + trailOffset - pos.y_m * SCALE
    if (trail.length === 0 || p.dist(bx, by, trail[trail.length - 1].x, trail[trail.length - 1].y) > 6) {
      trail.push({ x: bx, y: by })
    }
  }
  for (let i = 0; i < trail.length; i++) {
    const alpha = p.map(i, 0, trail.length, 20, 120)
    const sz = p.map(i, 0, trail.length, 2, 6)
    p.noStroke(); p.fill(ACCENT_BLUE[0], ACCENT_BLUE[1], ACCENT_BLUE[2], alpha)
    p.circle(trail[i].x, trail[i].y, sz)
  }

  // Completed arc
  if (!active && simTime > 0 && traj) {
    p.stroke(ACCENT_BLUE[0], ACCENT_BLUE[1], ACCENT_BLUE[2], 55); p.strokeWeight(1.5); p.noFill()
    p.beginShape()
    for (let ti = 0; ti <= T; ti += T / 80) {
      const pos = arcTr.positionAt(ti)
      const vOffset = LAUNCH_Y_OFFSET * (1 - ti / T)
      p.vertex(LAUNCH_X_PX + pos.x_m * SCALE, groundY + vOffset - pos.y_m * SCALE)
    }
    p.vertex(LAUNCH_X_PX + arcTr.range * SCALE, groundY)
    p.endShape()
  }

  // Ball
  let ballX, ballY
  if (!active && simTime === 0) {
    ballX = LAUNCH_X_PX + Math.cos(angle) * 44
    ballY = carriageTopY - Math.sin(angle) * 44
  } else if (traj) {
    const tClamped = Math.min(simTime, T)
    const pos = traj.positionAt(tClamped)
    const ballOffset = T > 0 ? LAUNCH_Y_OFFSET * (1 - tClamped / T) : LAUNCH_Y_OFFSET
    ballX = LAUNCH_X_PX + pos.x_m * SCALE
    ballY = groundY + ballOffset - pos.y_m * SCALE
  } else {
    ballX = LAUNCH_X_PX; ballY = groundY
  }
  p.noStroke(); p.fill(ACCENT_BLUE[0], ACCENT_BLUE[1], ACCENT_BLUE[2], 30); p.circle(ballX, ballY, 30)
  p.fill(ACCENT_BLUE[0], ACCENT_BLUE[1], ACCENT_BLUE[2], 60); p.circle(ballX, ballY, 20)
  p.fill(ACCENT_BLUE[0], ACCENT_BLUE[1], ACCENT_BLUE[2]); p.noStroke(); p.circle(ballX, ballY, 13)
  p.fill(SURFACE[0], SURFACE[1], SURFACE[2], 220); p.circle(ballX - 2, ballY - 2, 5)

  // Velocity component arrows (shown during active flight)
  if (active && traj) {
    const VEL_SCALE = 3.5
    const vx_val = speed * Math.cos(angle)
    const vy_val = speed * Math.sin(angle) - getGravity() * simTime
    const vxPx = vx_val * VEL_SCALE
    const vyPx = vy_val * VEL_SCALE  // positive physics vy → negative canvas y (upward)
    drawArrow(p, ballX, ballY, ballX + vxPx, ballY, ARROW_VX)
    drawArrow(p, ballX, ballY, ballX, ballY - vyPx, ARROW_VY)
    p.noStroke(); p.textSize(10); p.textAlign(p.LEFT)
    p.fill(ARROW_VX[0], ARROW_VX[1], ARROW_VX[2])
    p.text('vx ' + vx_val.toFixed(1) + ' m/s', ballX + vxPx + 4, ballY + 4)
    p.fill(ARROW_VY[0], ARROW_VY[1], ARROW_VY[2])
    const vyLabelY = vy_val >= 0 ? ballY - vyPx - 6 : ballY - vyPx + 12
    p.text('vy ' + vy_val.toFixed(1) + ' m/s', ballX + 4, vyLabelY)
  }

  // Range label after landing
  if (!active && simTime > 0 && traj) {
    const landingX = LAUNCH_X_PX + traj.range * SCALE
    p.stroke(YELLOW[0], YELLOW[1], YELLOW[2], 180); p.strokeWeight(1.5)
    p.line(landingX - 8, groundY - 4, landingX + 8, groundY - 4)
    p.line(landingX, groundY - 10, landingX, groundY + 2)
    const midX = (LAUNCH_X_PX + landingX) / 2
    p.noStroke(); p.fill(INK[0], INK[1], INK[2], 220)
    p.rect(midX - 54, groundY - 26, 108, 18, 4)
    p.fill(YELLOW[0], YELLOW[1], YELLOW[2]); p.noStroke(); p.textSize(11); p.textAlign(p.CENTER)
    p.text('Range: ' + traj.range.toFixed(1) + ' m', midX, groundY - 13)
  }

  // Angle/speed HUD
  const hudX = LAUNCH_X_PX + 46, hudY = groundY - 24
  p.noStroke(); p.fill(INK[0], INK[1], INK[2], 210)
  p.rect(hudX - 4, hudY - 13, 112, 18, 3)
  p.fill(INK_3[0], INK_3[1], INK_3[2]); p.noStroke(); p.textAlign(p.LEFT); p.textSize(11)
  p.text(angle_deg.toFixed(1) + '°  ·  ' + speed.toFixed(0) + ' m/s', hudX, hudY)
})

// Auto-launch the 30° anchor flight when the sim first loads
if (typeof runtime.autoLaunch === 'function') {
  setTimeout(function () { runtime.autoLaunch() }, 300)
}
