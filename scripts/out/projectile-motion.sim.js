const getAngle = runtime.registerParam('launch_angle', { min: 0, max: 90, default: 45, label: 'Launch Angle', unit: 'degrees' });
const getVelocity = runtime.registerParam('initial_velocity', { min: 5, max: 50, default: 20, label: 'Initial Velocity', unit: 'm/s' });
const getGravity = runtime.registerParam('gravity', { min: 1, max: 20, default: 9.81, label: 'Gravity', unit: 'm/s^2' });
const getHeight = runtime.registerParam('launch_height', { min: 0, max: 100, default: 0, label: 'Launch Height', unit: 'm' });

let t = 0;
let traj = null;
let isRunning = false;
let hasReachedPeak = false;

// Pre-calculate a default trajectory for initial region placement
const initTraj = () => {
  traj = runtime.physics.projectile(getVelocity(), getAngle(), getGravity());
};
initTraj();

runtime.registerRegion('launch_point', {
  getPosition: () => ({
    x: runtime.toScreenX(0),
    y: runtime.toScreenY(getHeight())
  })
});

runtime.registerRegion('landing_point', {
  getPosition: () => ({
    x: runtime.toScreenX(traj ? traj.range : 20),
    y: runtime.toScreenY(0)
  })
});

runtime.registerRegion('peak_height_marker', {
  getPosition: () => ({
    x: runtime.toScreenX(traj ? traj.range / 2 : 10),
    y: runtime.toScreenY(traj ? getHeight() + traj.peak.height_m : 10)
  })
});

runtime.registerRegion('trajectory_path', {
  getPosition: () => ({
    x: runtime.toScreenX(traj ? traj.range / 2 : 10),
    y: runtime.toScreenY(traj ? getHeight() + traj.peak.height_m : 10)
  })
});

runtime.episodic({
  onLaunch() {
    t = 0;
    hasReachedPeak = false;
    isRunning = true;
    initTraj();
    runtime.emit('projectile_launched');
  },
  onReset() {
    t = 0;
    isRunning = false;
    hasReachedPeak = false;
    initTraj();
  }
});

runtime.onUpdate((dt) => {
  if (!isRunning) return;

  t += dt;

  if (traj.didLand(t)) {
    runtime.emit('projectile_landed', {
      range_m: traj.range,
      time_of_flight_s: traj.flightTime
    });
    isRunning = false;
    runtime.endEpisode();
  }

  if (!hasReachedPeak && t >= traj.peak.t) {
    runtime.emit('peak_reached');
    hasReachedPeak = true;
  }
});

runtime.onRender((ctx) => {
  // Update trajectory based on current params
  initTraj();

  const range = traj.range || 1;
  const scale = (ctx.width * 0.8) / range;

  runtime.setCoordinateTransform({
    originX: ctx.width * 0.1,
    originY: ctx.height * 0.85,
    scaleX: scale,
    scaleY: scale
  });

  ctx.background(240);

  // Draw Ground
  ctx.stroke(100);
  ctx.strokeWeight(2);
  ctx.line(runtime.toScreenX(-10), runtime.toScreenY(0), runtime.toScreenX(range + 10), runtime.toScreenY(0));

  // Draw Trajectory Path
  ctx.noFill();
  ctx.stroke(150);
  ctx.strokeWeight(1);
  ctx.beginShape();
  const steps = 50;
  const endT = isRunning ? t : traj.flightTime;
  for (let i = 0; i <= steps; i++) {
    const sampleT = (endT / steps) * i;
    const pos = traj.positionAt(sampleT);
    ctx.vertex(runtime.toScreenX(pos.x_m), runtime.toScreenY(getHeight() + pos.y_m));
  }
  ctx.endShape();

  // Draw Ball
  const currentPos = traj.positionAt(isRunning ? t : 0);
  const ballX = runtime.toScreenX(currentPos.x_m);
  const ballY = runtime.toScreenY(getHeight() + currentPos.y_m);
  
  ctx.fill(200, 50, 50);
  ctx.noStroke();
  ctx.ellipse(ballX, ballY, 12, 12);

  // Annotations
  ctx.fill(50);
  ctx.textSize(14);
  ctx.textAlign(ctx.LEFT, ctx.TOP);
  
  if (!isRunning && t === 0) {
    ctx.text("Press Launch to Start", ctx.width / 2 - 50, 20);
  } else {
    ctx.text(`Time: ${t.toFixed(2)}s`, 20, 20);
  }
});