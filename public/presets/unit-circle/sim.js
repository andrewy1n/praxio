const ANGLE = runtime.registerParam('angle', { label: 'Angle (degrees)', min: 0, max: 360, default: 30, unit: '°' })

runtime.registerEvent('entered_second_quadrant')
runtime.registerEvent('sine_equals_cosine')

let prevAngle = null
let q2Fired = false
let sinCosFired = false

let px_point = { x: 200, y: 200 }
let px_sin_arm = { x: 200, y: 150 }
let px_cos_arm = { x: 150, y: 200 }

runtime.registerRegion('point_on_circle', { getPosition: () => px_point })
runtime.registerRegion('sin_arm', { getPosition: () => px_sin_arm })
runtime.registerRegion('cos_arm', { getPosition: () => px_cos_arm })

runtime.onUpdate(function () {
  const angle = ANGLE()
  if (angle !== prevAngle) {
    if (prevAngle !== null && prevAngle < 90 && angle >= 90) {
      const rad = (angle * Math.PI) / 180
      runtime.emit('entered_second_quadrant', { angle: Math.round(angle), sin: +Math.sin(rad).toFixed(3), cos: +Math.cos(rad).toFixed(3) })
    }
    if (!sinCosFired) {
      const rad = (angle * Math.PI) / 180
      if (Math.abs(Math.sin(rad) - Math.cos(rad)) < 0.05 && angle > 30 && angle < 60) {
        sinCosFired = true
        runtime.emit('sine_equals_cosine', { angle: Math.round(angle) })
      }
    }
    prevAngle = angle
  }
})

runtime.onRender(function (ctx) {
  const W = ctx.canvas.clientWidth
  const H = ctx.canvas.clientHeight
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) * 0.36

  const rad = (ANGLE() * Math.PI) / 180
  const cosV = Math.cos(rad)
  const sinV = Math.sin(rad)
  const px = cx + cosV * R
  const py = cy - sinV * R

  ctx.clearRect(0, 0, W, H)

  // Background
  ctx.fillStyle = '#fafafa'
  ctx.fillRect(0, 0, W, H)

  // Grid lines (subtle)
  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke()
  ctx.setLineDash([])

  // Circle
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()

  // Radius labels
  ctx.fillStyle = '#94a3b8'
  ctx.font = '11px monospace'
  ctx.textAlign = 'center'
  ctx.fillText('1', cx + R / 2, cy - 6)

  // cos arm (horizontal, green)
  ctx.strokeStyle = '#22c55e'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, cy); ctx.stroke()
  px_cos_arm = { x: cx + cosV * R / 2, y: cy + 18 }

  // sin arm (vertical, blue)
  ctx.strokeStyle = '#3b82f6'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(px, cy); ctx.lineTo(px, py); ctx.stroke()
  px_sin_arm = { x: px + (cosV >= 0 ? 18 : -18), y: cy - sinV * R / 2 }

  // Hypotenuse (radius to point)
  ctx.strokeStyle = '#6366f1'
  ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke()

  // Angle arc
  const arcEnd = -rad
  ctx.strokeStyle = '#a78bfa'
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.2, 0, arcEnd, sinV < 0); ctx.stroke()

  // Dashed drop lines
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx, py); ctx.stroke()
  ctx.setLineDash([])

  // Point on circle
  ctx.fillStyle = '#6366f1'
  ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill()
  px_point = { x: px, y: py }

  // Origin dot
  ctx.fillStyle = '#94a3b8'
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill()

  // Labels: cos and sin values
  const cosLabel = cosV.toFixed(2)
  const sinLabel = sinV.toFixed(2)

  // cos value below arm
  ctx.fillStyle = '#16a34a'
  ctx.font = 'bold 12px monospace'
  ctx.textAlign = 'center'
  ctx.fillText('cos = ' + cosLabel, cx + cosV * R / 2, cy + 32)

  // sin value beside arm
  ctx.fillStyle = '#1d4ed8'
  ctx.textAlign = cosV >= 0 ? 'left' : 'right'
  ctx.fillText('sin = ' + sinLabel, px + (cosV >= 0 ? 12 : -12), cy - sinV * R / 2)

  // Angle label
  ctx.fillStyle = '#7c3aed'
  ctx.font = '13px monospace'
  ctx.textAlign = 'left'
  const a = ANGLE()
  const degLabel = Math.round(a) + '°'
  const radLabel = (a * Math.PI / 180).toFixed(2) + ' rad'
  ctx.fillText('θ = ' + degLabel + '  (' + radLabel + ')', 14, H - 28)

  // Quadrant label
  const q = a < 90 ? 'I' : a < 180 ? 'II' : a < 270 ? 'III' : 'IV'
  ctx.fillStyle = '#94a3b8'
  ctx.font = '11px monospace'
  ctx.textAlign = 'right'
  ctx.fillText('Quadrant ' + q, W - 14, H - 28)

  // Axis tick labels
  ctx.fillStyle = '#9ca3af'
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'
  ctx.fillText('1', cx + R + 14, cy + 4)
  ctx.fillText('−1', cx - R - 18, cy + 4)
  ctx.fillText('1', cx + 4, cy - R - 6)
  ctx.fillText('−1', cx + 4, cy + R + 14)
})
