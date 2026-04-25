const G = 9.8
const SCALE = 8
const LAUNCH_X_PX = 72

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
  _groundY = p.height * 0.80
  const groundY = _groundY
  const angle_deg = getAngle(), speed = getSpeed()
  const angle = angle_deg * Math.PI / 180
  const vx = speed * Math.cos(angle), vy = speed * Math.sin(angle)
  const { T } = computeTrajectory(speed, angle_deg)

  // Sky gradient background
  for (let y = 0; y < groundY; y++) {
    const t = y / groundY
    const r = p.lerp(12, 20, t), g2 = p.lerp(18, 28, t), b = p.lerp(35, 18, t)
    p.stroke(r, g2, b); p.strokeWeight(1)
    p.line(0, y, p.width, y)
  }

  // Ground fill
  p.noStroke(); p.fill(22, 32, 18)
  p.rect(0, groundY, p.width, p.height - groundY)

  // Ground surface line with subtle glow
  p.stroke(80, 160, 60, 180); p.strokeWeight(2)
  p.line(0, groundY, p.width, groundY)
  p.stroke(80, 160, 60, 40); p.strokeWeight(6)
  p.line(0, groundY, p.width, groundY)

  // Subtle distance grid lines
  p.stroke(255, 255, 255, 12); p.strokeWeight(1)
  for (let gx = 120; gx < p.width; gx += 80) {
    p.line(gx, groundY - 6, gx, groundY + 4)
  }

  // Cannon wheels
  p.fill(55, 50, 45); p.noStroke()
  p.circle(LAUNCH_X_PX - 10, groundY - 1, 22)
  p.circle(LAUNCH_X_PX + 6, groundY - 1, 18)
  p.fill(40, 36, 32)
  p.circle(LAUNCH_X_PX - 10, groundY - 1, 12)
  p.circle(LAUNCH_X_PX + 6, groundY - 1, 9)
  p.stroke(90, 82, 72); p.strokeWeight(1.5)
  p.noFill()
  p.circle(LAUNCH_X_PX - 10, groundY - 1, 22)
  p.circle(LAUNCH_X_PX + 6, groundY - 1, 18)

  // Cannon barrel — thick with highlight
  const bx2 = LAUNCH_X_PX + Math.cos(angle) * 38
  const by2 = groundY - Math.sin(angle) * 38
  p.stroke(130, 125, 115); p.strokeWeight(9)
  p.line(LAUNCH_X_PX, groundY - 4, bx2, by2)
  p.stroke(80, 76, 68); p.strokeWeight(9)
  p.line(LAUNCH_X_PX, groundY - 4, LAUNCH_X_PX + Math.cos(angle) * 20, groundY - 4 - Math.sin(angle) * 20)
  p.stroke(170, 162, 148); p.strokeWeight(3)
  const nx = -Math.sin(angle) * 1.5, ny = Math.cos(angle) * 1.5
  p.line(LAUNCH_X_PX + nx, groundY - 4 + ny, bx2 + nx, by2 + ny)

  // Cannon body
  p.fill(90, 82, 72); p.noStroke()
  p.circle(LAUNCH_X_PX, groundY - 4, 20)
  p.fill(120, 110, 96)
  p.circle(LAUNCH_X_PX - 2, groundY - 6, 10)

  // Launch direction indicator (only shown pre-launch)
  if (!active && simTime === 0) {
    const arrowLen = 48
    const ax = LAUNCH_X_PX + Math.cos(angle) * arrowLen
    const ay = groundY - Math.sin(angle) * arrowLen
    p.stroke(250, 204, 21, 120); p.strokeWeight(1.5)
    p.line(LAUNCH_X_PX, groundY - 4, ax, ay)
    // Arrow head
    const headLen = 7
    const headAngle1 = angle + 2.6
    const headAngle2 = angle - 2.6
    p.line(ax, ay, ax - Math.cos(headAngle1) * headLen, ay + Math.sin(headAngle1) * headLen)
    p.line(ax, ay, ax - Math.cos(headAngle2) * headLen, ay + Math.sin(headAngle2) * headLen)
  }

  // Trail dots
  if (active) {
    const ballX = LAUNCH_X_PX + vx * simTime * SCALE
    const ballY = groundY - (vy * simTime - 0.5 * G * simTime * simTime) * SCALE
    if (trail.length === 0 || p.dist(ballX, ballY, trail[trail.length - 1].x, trail[trail.length - 1].y) > 6) {
      trail.push({ x: ballX, y: ballY })
    }
  }
  for (let i = 0; i < trail.length; i++) {
    const alpha = p.map(i, 0, trail.length, 20, 120)
    const sz = p.map(i, 0, trail.length, 2, 6)
    p.noStroke(); p.fill(96, 165, 250, alpha)
    p.circle(trail[i].x, trail[i].y, sz)
  }

  // Completed arc (shown after landing)
  if (!active && simTime > 0) {
    p.stroke(96, 165, 250, 55); p.strokeWeight(1.5); p.noFill()
    p.beginShape()
    for (let ti = 0; ti <= T; ti += T / 80) {
      p.vertex(LAUNCH_X_PX + vx * ti * SCALE, groundY - (vy * ti - 0.5 * G * ti * ti) * SCALE)
    }
    p.vertex(LAUNCH_X_PX + vx * T * SCALE, groundY)
    p.endShape()
  }

  // Ball — sit at muzzle tip pre-launch, fly during active, stay at landing after done
  const ct = simTime
  let ballX, ballY
  if (!active && simTime === 0) {
    ballX = LAUNCH_X_PX + Math.cos(angle) * 42
    ballY = groundY - Math.sin(angle) * 42
  } else {
    ballX = LAUNCH_X_PX + vx * ct * SCALE
    ballY = groundY - (vy * ct - 0.5 * G * ct * ct) * SCALE
  }
  // Glow
  p.noStroke(); p.fill(96, 165, 250, 30)
  p.circle(ballX, ballY, 30)
  p.fill(96, 165, 250, 60)
  p.circle(ballX, ballY, 20)
  // Ball body
  p.fill(96, 165, 250); p.noStroke()
  p.circle(ballX, ballY, 13)
  // Highlight
  p.fill(200, 225, 255, 160)
  p.circle(ballX - 2, ballY - 2, 5)

  // Landing marker
  if (!active && simTime > 0) {
    const landingX = LAUNCH_X_PX + vx * T * SCALE
    p.stroke(250, 204, 21, 180); p.strokeWeight(1.5)
    p.line(landingX - 8, groundY - 4, landingX + 8, groundY - 4)
    p.line(landingX, groundY - 10, landingX, groundY + 2)
    // Range label with background
    const midX = (LAUNCH_X_PX + landingX) / 2
    p.noStroke(); p.fill(0, 0, 0, 140)
    p.rect(midX - 54, groundY - 26, 108, 18, 4)
    p.fill('#facc15'); p.noStroke(); p.textSize(11); p.textAlign(p.CENTER)
    p.text('Range: ' + rangeM.toFixed(1) + ' m', midX, groundY - 13)
  }

  // Angle / speed HUD
  const hudX = LAUNCH_X_PX + 46, hudY = groundY - 24
  p.noStroke(); p.fill(0, 0, 0, 130)
  p.rect(hudX - 4, hudY - 13, 112, 18, 3)
  p.fill(180, 180, 180); p.noStroke(); p.textAlign(p.LEFT); p.textSize(11)
  p.text(angle_deg.toFixed(1) + '°  ·  ' + speed.toFixed(0) + ' m/s', hudX, hudY)
})
