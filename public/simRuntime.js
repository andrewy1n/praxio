// simRuntime.js — Praxio simulation runtime
// Runs inside the sandboxed iframe. Loaded by all /iframe/*.html templates.
// See planning/simulation-runtime-sdk.md for the full SDK spec.
//
// Person A implements this file. Do not add DOM access to parent frame.

;(function () {
  'use strict'

  // ── State ──────────────────────────────────────────────────────────────────

  const params = {}          // name → { value, min, max, default, label, unit }
  const lockedParams = new Set()
  const regions = {}         // name → { getPosition: () => ({ x, y }) }
  const events = []
  const annotations = {}    // region → text
  const checkpoints = {}    // id → snapshot

  let updateFn = null
  let renderFn = null
  let launchFn = null
  let resetFn = null
  let episodic = false
  let animFrameId = null
  let lastTime = null
  let paused = false
  let trackRegions = false
  let lastRegionPositionSentAt = 0

  // ── Renderer context ───────────────────────────────────────────────────────

  const renderer = window.__SIM_RENDERER__ || 'canvas2d'
  let rendererContext = null
  let resizeHandler = null

  // ── SDK surface exposed to generated sim code ──────────────────────────────

  const runtime = {
    registerParam(name, options) {
      params[name] = {
        value: options.default,
        min: options.min,
        max: options.max,
        default: options.default,
        label: options.label,
        unit: options.unit,
        step: options.step,
      }
      // Return a reactive getter
      return () => params[name].value
    },

    registerRegion(name, options) {
      if (!options || typeof options.getPosition !== 'function') {
        throw new Error(`registerRegion("${name}") requires { getPosition: () => ({ x, y }) }`)
      }
      regions[name] = {
        getPosition: options.getPosition,
      }
    },

    registerEvent(name) {
      if (!events.includes(name)) events.push(name)
    },

    onUpdate(fn) {
      updateFn = fn
    },

    onRender(fn) {
      renderFn = fn
    },

    onLaunch(fn) {
      launchFn = fn
      episodic = true
    },

    onReset(fn) {
      resetFn = fn
    },

    reportPhase(phase) {
      parent.postMessage({ type: 'SIM_PHASE', phase }, '*')
    },

    emit(name, payload = {}) {
      parent.postMessage({ type: 'SIM_EVENT', event: name, payload, timestamp: Date.now() }, '*')
    },

    emitEvent(name, payload = {}) {
      parent.postMessage({ type: 'SIM_EVENT', event: name, payload, timestamp: Date.now() }, '*')
    },
  }

  // ── postMessage → parent ───────────────────────────────────────────────────

  function sendManifest() {
    parent.postMessage({
      type: 'MANIFEST',
      params: Object.entries(params).map(([name, p]) => ({
        name, min: p.min, max: p.max, default: p.default, label: p.label, unit: p.unit,
      })),
      regions: Object.keys(regions),
      events: [...events],
      animates: renderer !== 'jsxgraph',
      episodic,
    }, '*')
  }

  function sendRegionPositions(now = performance.now()) {
    if (!trackRegions || now - lastRegionPositionSentAt < 100) return
    lastRegionPositionSentAt = now

    const positions = {}
    Object.entries(regions).forEach(([name, region]) => {
      try {
        const pos = region.getPosition()
        positions[name] = Number.isFinite(pos?.x) && Number.isFinite(pos?.y)
          ? { x: pos.x, y: pos.y }
          : null
      } catch (err) {
        positions[name] = null
      }
    })

    parent.postMessage({ type: 'REGION_POSITIONS', regions: positions }, '*')
  }

  // ── Agent commands from parent ─────────────────────────────────────────────

  window.addEventListener('message', (e) => {
    const msg = e.data
    if (!msg || !msg.type) return

    if (msg.type === 'LOAD_SIM') {
      loadSim(msg.code)
      return
    }

    if (msg.type === 'TRACK_REGIONS') {
      trackRegions = Boolean(msg.enabled)
      return
    }

    if (msg.type === 'AGENT_CMD') {
      handleAgentCmd(msg)
    }
  })

  function handleAgentCmd(msg) {
    switch (msg.action) {
      case 'set_param': {
        const p = params[msg.target]
        if (!p || lockedParams.has(msg.target)) return
        const prev = p.value
        p.value = Math.min(p.max, Math.max(p.min, msg.value))
        parent.postMessage({
          type: 'PARAM_CHANGED',
          param: msg.target,
          from: prev,
          to: p.value,
          sim_state: currentState(),
        }, '*')
        break
      }
      case 'lock':
        lockedParams.add(msg.target)
        break
      case 'unlock':
        lockedParams.delete(msg.target)
        break
      case 'highlight':
        // No-op in iframe — highlight is a param sidebar effect owned by the parent
        break
      case 'annotate':
        annotations[msg.region] = msg.text
        break
      case 'clear_annotations':
        Object.keys(annotations).forEach(k => delete annotations[k])
        break
      case 'checkpoint': {
        const id = 'ckpt_' + Math.random().toString(36).slice(2, 8)
        checkpoints[id] = snapshotState()
        parent.postMessage({ type: 'CHECKPOINT_SAVED', id }, '*')
        break
      }
      case 'restore': {
        const snap = checkpoints[msg.id]
        if (!snap) return
        restoreState(snap)
        break
      }
      case 'trigger_event':
        runtime.emitEvent(msg.eventType, {})
        break
      case 'set_scene':
        Object.entries(msg.config).forEach(([name, value]) => {
          if (params[name]) params[name].value = value
        })
        break
      case 'launch':
        if (launchFn) {
          launchFn()
          parent.postMessage({ type: 'SIM_PHASE', phase: 'active' }, '*')
        }
        break
      case 'reset':
        if (resetFn) {
          resetFn()
          parent.postMessage({ type: 'SIM_PHASE', phase: 'idle' }, '*')
        }
        break
      case 'pause':
        if (renderer !== 'jsxgraph' && !paused) {
          paused = true
          parent.postMessage({ type: 'SIM_PAUSED' }, '*')
        }
        break
      case 'play':
        if (renderer !== 'jsxgraph' && paused) {
          paused = false
          lastTime = null
          parent.postMessage({ type: 'SIM_RESUMED' }, '*')
        }
        break
    }
  }

  // ── Snapshot helpers ───────────────────────────────────────────────────────

  function currentState() {
    return Object.fromEntries(Object.entries(params).map(([k, p]) => [k, p.value]))
  }

  function snapshotState() {
    return { paramValues: currentState() }
  }

  function restoreState(snap) {
    Object.entries(snap.paramValues).forEach(([k, v]) => {
      if (params[k]) params[k].value = v
    })
  }

  // ── Sim code loader ────────────────────────────────────────────────────────

  function loadSim(code) {
    stopLoop()

    // Reset state
    Object.keys(params).forEach(k => delete params[k])
    lockedParams.clear()
    Object.keys(regions).forEach(k => delete regions[k])
    events.length = 0
    updateFn = null
    renderFn = null
    launchFn = null
    resetFn = null
    episodic = false
    paused = false
    trackRegions = false
    lastRegionPositionSentAt = 0

    try {
      const executableCode = sanitizeCode(code)
      // eslint-disable-next-line no-new-func
      const factory = new Function('runtime', executableCode)
      factory(runtime)
      sendManifest()
      try {
        rendererContext = buildRendererContext()
      } catch (err) {
        parent.postMessage({
          type: 'SIM_ERROR',
          error: `renderer init error: ${String(err)}`,
        }, '*')
        return
      }
      startLoop()
    } catch (err) {
      parent.postMessage({ type: 'SIM_ERROR', error: String(err) }, '*')
    }
  }

  // ── Renderer context builders ──────────────────────────────────────────────
  // p5 → pass p5 instance; jsxgraph → pass board; matter → pass engine bundle; canvas2d → pass ctx

  function buildRendererContext() {
    if (renderer === 'canvas2d') return buildCanvas2dContext()
    if (renderer === 'p5') return buildP5Context()
    if (renderer === 'jsxgraph') return buildJsxGraphContext()
    if (renderer === 'matter') return buildMatterContext()
    return null
  }

  function buildCanvas2dContext() {
    const canvas = document.getElementById('sim-canvas')
    if (!canvas) throw new Error('Canvas renderer selected but #sim-canvas was not found')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context could not be created')

    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr))
      canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr))
      canvas.style.width = window.innerWidth + 'px'
      canvas.style.height = window.innerHeight + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    fit()
    resizeHandler = fit
    window.addEventListener('resize', fit)
    return ctx
  }

  function buildP5Context() {
    if (typeof window.p5 !== 'function') {
      throw new Error('p5 renderer selected but p5 is not loaded')
    }

    let instance = null
    instance = new window.p5((p) => {
      p.setup = function () {
        p.createCanvas(window.innerWidth, window.innerHeight)
        p.noLoop()
      }
      p.windowResized = function () {
        p.resizeCanvas(window.innerWidth, window.innerHeight)
      }
    })
    return instance
  }

  function buildJsxGraphContext() {
    if (!window.JXG || !window.JXG.JSXGraph) {
      throw new Error('jsxgraph renderer selected but JSXGraph is not loaded')
    }
    const container = document.getElementById('jxgbox')
    if (!container) throw new Error('JSXGraph renderer selected but #jxgbox was not found')

    return window.JXG.JSXGraph.initBoard('jxgbox', {
      boundingbox: [-10, 10, 10, -10],
      axis: true,
      showNavigation: false,
      showCopyright: false,
    })
  }

  function buildMatterContext() {
    if (!window.Matter) {
      throw new Error('matter renderer selected but Matter.js is not loaded')
    }
    const engine = window.Matter.Engine.create()
    return {
      Matter: window.Matter,
      engine,
      world: engine.world,
    }
  }

  function disposeRendererContext() {
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler)
      resizeHandler = null
    }
    if (!rendererContext) return

    if (renderer === 'p5' && typeof rendererContext.remove === 'function') {
      rendererContext.remove()
    }
    if (renderer === 'jsxgraph' && window.JXG && typeof window.JXG.JSXGraph?.freeBoard === 'function') {
      window.JXG.JSXGraph.freeBoard(rendererContext)
    }

    rendererContext = null
  }

  function sanitizeCode(code) {
    const source = String(code || '').trim()
    const fenced = source.match(/^```(?:javascript|js)?\s*([\s\S]*?)\s*```$/i)
    if (fenced) return fenced[1]
    return source
  }

  function reportLoopError(phase, err) {
    parent.postMessage({
      type: 'SIM_ERROR',
      error: `${phase} error: ${String(err)}`,
    }, '*')
    stopLoop()
  }

  // ── Animation loop ─────────────────────────────────────────────────────────

  function startLoop() {
    lastTime = null
    function tick(now) {
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0
      lastTime = now
      if (updateFn && !paused) {
        try {
          updateFn(dt)
        } catch (err) {
          reportLoopError('onUpdate', err)
          return
        }
      }
      if (renderFn) {
        try {
          renderFn(rendererContext)
        } catch (err) {
          reportLoopError('onRender', err)
          return
        }
      }
      sendRegionPositions(now)
      animFrameId = requestAnimationFrame(tick)
    }
    animFrameId = requestAnimationFrame(tick)
  }

  function stopLoop() {
    if (animFrameId) cancelAnimationFrame(animFrameId)
    animFrameId = null
    disposeRendererContext()
  }

})()
