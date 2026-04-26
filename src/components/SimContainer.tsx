'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IframeMessage, AgentCmd, Manifest, SimEvent, SocraticStep } from '@/lib/types'
import { analyzeSketch } from '@/lib/sketchAnalysis'

type Props = {
  simCode: string | null
  renderer: 'p5' | 'canvas2d' | 'jsxgraph' | 'matter' | null
  onManifest: (manifest: Manifest) => void
  onMessage: (msg: IframeMessage) => void
  activeStep?: SocraticStep | null
  /** Socratic step id; include in effects so re-entering a step re-applies staging (same step object ref can otherwise skip effects). */
  activeStepId?: string | null
  /** `false` only when design doc explicitly sets `episodic: false` (omitted/undefined counts as not blocking). */
  episodicFromDesign?: boolean
  onStepEvent?: (event: SimEvent) => void
  agentCommands?: AgentCmd[]
}

export default function SimContainer({
  simCode,
  renderer,
  onManifest,
  onMessage,
  activeStep = null,
  activeStepId = null,
  episodicFromDesign = true,
  onStepEvent,
  agentCommands = [],
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const simCodeRef = useRef<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const appliedAgentCommandCountRef = useRef(0)
  const [isDrawing, setIsDrawing] = useState(false)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, number>>({})
  const [paramInputDrafts, setParamInputDrafts] = useState<Record<string, string>>({})
  const [regionPositions, setRegionPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [annotations, setAnnotations] = useState<Record<string, string>>({})
  const [predictionPoints, setPredictionPoints] = useState<Array<{ x: number; y: number }>>([])
  const [hypothesisValue, setHypothesisValue] = useState('')

  const interaction = activeStep?.interaction
  const staging = activeStep?.staging
  const highlightedParams = new Set([
    ...(staging?.highlight || []),
    ...(interaction?.kind === 'manipulate_param' ? interaction.params : []),
  ])
  const lockedParams = new Set(staging?.lock || [])

  useEffect(() => {
    simCodeRef.current = simCode
    appliedAgentCommandCountRef.current = 0
  }, [simCode])

  const sendCmd = useCallback((cmd: AgentCmd) => {
    iframeRef.current?.contentWindow?.postMessage(cmd, '*')
  }, [])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return
      const msg = e.data as IframeMessage
      if (msg.type === 'MANIFEST') {
        const m: Manifest = { params: msg.params, regions: msg.regions, events: msg.events, animates: !!msg.animates, episodic: !!msg.episodic }
        setManifest(m)
        setParamValues(Object.fromEntries(msg.params.map(p => [p.name, p.default])))
        setParamInputDrafts({})
        onManifest(m)
      }
      if (msg.type === 'PARAM_CHANGED') {
        setParamValues(prev => ({ ...prev, [msg.param]: msg.to }))
      }
      if (msg.type === 'REGION_POSITIONS') {
        setRegionPositions(Object.fromEntries(
          Object.entries(msg.regions)
            .filter((entry): entry is [string, { x: number; y: number }] => Boolean(entry[1])),
        ))
      }
      if (msg.type === 'ANNOTATIONS') {
        setAnnotations(msg.annotations || {})
      }
      onMessage(msg)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onManifest, onMessage])

  const sendLoadSim = useCallback((code: string) => sendCmd({ type: 'LOAD_SIM', code }), [sendCmd])

  useEffect(() => {
    if (!simCode) return
    sendLoadSim(simCode)
  }, [simCode, sendLoadSim])

  useEffect(() => {
    const nextCommands = agentCommands.slice(appliedAgentCommandCountRef.current)
    nextCommands.forEach(sendCmd)
    appliedAgentCommandCountRef.current = agentCommands.length
  }, [agentCommands, sendCmd])

  useEffect(() => {
    queueMicrotask(() => {
      setPredictionPoints([])
      setHypothesisValue('')
      setIsDrawing(false)
    })
    if (!activeStep) return

    activeStep.staging.lock?.forEach(target => sendCmd({ type: 'AGENT_CMD', action: 'lock', target }))
    activeStep.staging.unlock?.forEach(target => sendCmd({ type: 'AGENT_CMD', action: 'unlock', target }))
    activeStep.staging.highlight?.forEach(target => sendCmd({ type: 'AGENT_CMD', action: 'highlight', target }))
    if (activeStep.staging.clear_annotations) {
      sendCmd({ type: 'AGENT_CMD', action: 'clear_annotations' })
    }
    activeStep.staging.annotate?.forEach(({ region, text }) => {
      sendCmd({ type: 'AGENT_CMD', action: 'annotate', region, text })
    })
    // Agent must apply staged values even if a prior step left params locked in the iframe.
    Object.keys(activeStep.staging.set_params || {}).forEach(target => {
      sendCmd({ type: 'AGENT_CMD', action: 'unlock', target })
    })
    Object.entries(activeStep.staging.set_params || {}).forEach(([target, value]) => {
      setParamValues(prev => ({ ...prev, [target]: value }))
      sendCmd({ type: 'AGENT_CMD', action: 'set_param', target, value })
    })
    const st = activeStep.staging
    const hasSetParams = Boolean(st.set_params && Object.keys(st.set_params).length > 0)
    let shouldLaunch = false
    if (st.launch === false) {
      shouldLaunch = false
    } else if (st.launch === true) {
      shouldLaunch = true
    } else {
      // Omitted in older design docs: manifest says episodic + set_params => one flight; design `episodic: false` opts out
      shouldLaunch = Boolean(
        hasSetParams
        && manifest?.episodic
        && episodicFromDesign,
      )
    }
    let launchAfterParamTimer: ReturnType<typeof setTimeout> | null = null
    if (shouldLaunch) {
      // Defer so iframe message queue finishes set_param (and any reload) before launch
      launchAfterParamTimer = setTimeout(() => {
        sendCmd({ type: 'AGENT_CMD', action: 'launch' })
      }, 16)
    }
    return () => {
      if (launchAfterParamTimer) clearTimeout(launchAfterParamTimer)
    }
  }, [activeStep, activeStepId, sendCmd, manifest?.episodic, episodicFromDesign])

  const hasAnnotations = Object.keys(annotations).length > 0
  useEffect(() => {
    sendCmd({
      type: 'TRACK_REGIONS',
      enabled:
        interaction?.kind === 'click_to_query'
        || Boolean(staging?.annotate?.length)
        || hasAnnotations,
    })
  }, [interaction?.kind, staging?.annotate?.length, hasAnnotations, sendCmd])

  const handleSlider = (name: string, value: number) => {
    setParamValues(prev => ({ ...prev, [name]: value }))
    sendCmd({ type: 'AGENT_CMD', action: 'set_param', target: name, value })
  }

  const clampParamValue = (value: number, min: number, max: number) => {
    if (value < min) return min
    if (value > max) return max
    return value
  }

  const handleParamNumberInput = (name: string, rawValue: string, min: number, max: number, fallback: number) => {
    if (rawValue.trim() === '') return
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) return
    handleSlider(name, clampParamValue(parsed, min, max))
    setParamInputDrafts(prev => {
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  const resetParamDraft = (name: string) => {
    setParamInputDrafts(prev => {
      if (!(name in prev)) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  const emitStepEvent = (event: Omit<SimEvent, 'timestamp'>) => {
    onStepEvent?.({ ...event, timestamp: Date.now() })
  }

  const submitHypothesis = () => {
    if (interaction?.kind !== 'numeric_hypothesis') return
    const value = Number(hypothesisValue)
    if (!Number.isFinite(value)) return
    emitStepEvent({
      event: 'hypothesis_submitted',
      payload: {
        metric: interaction.metric,
        value,
        unit: interaction.unit,
      },
    })
    setHypothesisValue('')
  }

  const submitPredictionSketch = () => {
    if (predictionPoints.length < 2) return
    const rect = canvasRef.current?.getBoundingClientRect()
    const analysis = analyzeSketch(
      predictionPoints,
      rect?.width ?? 800,
      rect?.height ?? 500,
    )
    emitStepEvent({
      event: 'prediction_sketch_submitted',
      payload: {
        points: predictionPoints.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })),
        coordinate_space: 'iframe_css_pixels',
        analysis,
      },
    })
  }

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const nearestRegion = (x: number, y: number) => {
    const candidates = interaction?.kind === 'click_to_query' && interaction.regions.length > 0
      ? interaction.regions
      : manifest?.regions || []
    return candidates.reduce<{ region: string; dist: number } | null>((best, region) => {
      const pos = regionPositions[region]
      if (!pos) return best
      const dist = (pos.x - x) ** 2 + (pos.y - y) ** 2
      return !best || dist < best.dist ? { region, dist } : best
    }, null)?.region || null
  }

  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interaction) return
    const point = pointerPosition(event)
    if (interaction.kind === 'prediction_sketch') {
      setIsDrawing(true)
      setPredictionPoints([point])
      return
    }
    if (interaction.kind === 'click_to_query') {
      const region = nearestRegion(point.x, point.y)
      if (!region) return
      emitStepEvent({
        event: 'focus_selected',
        payload: { region, x: Math.round(point.x), y: Math.round(point.y) },
      })
    }
  }

  const handleOverlayPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || interaction?.kind !== 'prediction_sketch') return
    const point = pointerPosition(event)
    setPredictionPoints(prev => [...prev, point])
  }

  const overlayEnabled = interaction?.kind === 'prediction_sketch' || interaction?.kind === 'click_to_query'

  const regionNameAccentClass: Record<string, string> = {
    launch: 'text-amber-200',
    apex: 'text-sky-300',
    landing: 'text-sky-300',
  }

  if (!renderer) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Enter a concept to generate a simulation
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <iframe
        ref={iframeRef}
        src={`/iframe/${renderer}.html`}
        className="absolute inset-0 w-full h-full border-0"
        sandbox="allow-scripts"
        title="simulation"
        onLoad={() => { if (simCodeRef.current) sendLoadSim(simCodeRef.current) }}
      />
      {Object.keys(annotations).length > 0 && (
        <div className="absolute inset-0 z-20 pointer-events-none">
          {Object.entries(annotations).map(([region, text]) => {
            const pos = regionPositions[region]
            if (!pos) return null
            return (
              <div
                key={region}
                className="absolute max-w-[280px] rounded-md bg-stone-900/75 px-2.5 py-1.5 text-xs font-normal leading-snug"
                style={{
                  left: pos.x + 12,
                  top: pos.y,
                  transform: 'translateY(-50%)',
                }}
              >
                <span className="break-words whitespace-normal text-white/95">
                  <span className={regionNameAccentClass[region] ?? 'text-sky-300'}>
                    {region}
                  </span>
                  {' · '}
                  {text}
                </span>
              </div>
            )
          })}
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={800}
        height={500}
        className="absolute inset-0 w-full h-full z-10"
        style={{ pointerEvents: overlayEnabled ? 'auto' : 'none' }}
        onPointerDown={handleOverlayPointerDown}
        onPointerMove={handleOverlayPointerMove}
        onPointerUp={() => setIsDrawing(false)}
        onPointerLeave={() => setIsDrawing(false)}
      />
      {predictionPoints.length > 1 && (
        <svg className="absolute inset-0 w-full h-full z-10 pointer-events-none">
          <polyline
            points={predictionPoints.map(point => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke="#22d3ee"
            strokeDasharray="6 4"
            strokeWidth="2"
          />
        </svg>
      )}
      {manifest && manifest.params.length > 0 && (
        <div
          className="absolute left-4 top-4 z-20 min-w-[228px] overflow-hidden rounded-[var(--r)] border bg-[rgba(255,255,255,0.97)] shadow-[var(--shadow-lg)]"
          style={{ borderColor: 'var(--border)' }}
        >
          <div
            className="border-b px-3 py-2 font-[family-name:var(--font-dm-mono)] text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink3)]"
            style={{ borderColor: 'var(--border)' }}
          >
            Parameters
          </div>
          {manifest.params.map(param => (
            <div
              key={param.name}
              className="relative flex items-center gap-2 px-3 py-2"
              style={{
                background: highlightedParams.has(param.name) ? 'var(--accent-light)' : 'transparent',
                opacity: lockedParams.has(param.name) ? 0.45 : 1,
              }}
            >
              {highlightedParams.has(param.name) ? (
                <div
                  className="absolute left-0 top-0 h-full w-[2px]"
                  style={{ background: 'var(--accent)' }}
                />
              ) : null}

              <span
                className="flex min-w-[90px] items-center gap-1.5 text-[12px] font-medium"
                style={{ color: highlightedParams.has(param.name) ? 'var(--accent)' : 'var(--ink2)' }}
              >
                {lockedParams.has(param.name) ? (
                  <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden>
                    <rect x="1" y="5" width="8" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M3 5V3.5a2 2 0 1 1 4 0V5" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                ) : null}
                {param.label}
              </span>

              <input
                type="range"
                min={param.min}
                max={param.max}
                step={(param.max - param.min) / 100}
                value={paramValues[param.name] ?? param.default}
                onChange={e => handleSlider(param.name, parseFloat(e.target.value))}
                disabled={lockedParams.has(param.name)}
                className="min-w-0 flex-1"
                style={{ accentColor: 'var(--accent)' }}
              />

              <div className="flex min-w-[86px] items-center justify-end gap-1">
                <input
                  type="number"
                  min={param.min}
                  max={param.max}
                  step={(param.max - param.min) / 100}
                  value={paramInputDrafts[param.name] ?? String(paramValues[param.name] ?? param.default)}
                  onChange={e => {
                    const raw = e.target.value
                    setParamInputDrafts(prev => ({ ...prev, [param.name]: raw }))
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleParamNumberInput(
                        param.name,
                        paramInputDrafts[param.name] ?? String(paramValues[param.name] ?? param.default),
                        param.min,
                        param.max,
                        param.default,
                      )
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      resetParamDraft(param.name)
                    }
                  }}
                  onBlur={() => resetParamDraft(param.name)}
                  disabled={lockedParams.has(param.name)}
                  className="w-[56px] rounded-[var(--r-sm)] border bg-[var(--surface)] px-1.5 py-1 text-right font-[family-name:var(--font-dm-mono)] text-[11px] font-medium tabular-nums outline-none focus:border-[color:var(--accent)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink3)' }}
                  aria-label={`${param.label} value`}
                />
                {param.unit ? (
                  <span
                    className="font-[family-name:var(--font-dm-mono)] text-[11px] font-medium"
                    style={{ color: 'var(--ink3)' }}
                  >
                    {param.unit}
                  </span>
                ) : null}
              </div>
              </div>
          ))}
        </div>
      )}
      {interaction?.kind === 'numeric_hypothesis' && (
        <div
          className="absolute right-4 top-14 z-20 flex w-64 flex-col gap-2 overflow-hidden rounded-[var(--r)] border bg-[rgba(255,255,255,0.97)] p-3 shadow-[var(--shadow-lg)]"
          style={{ borderColor: 'var(--border)' }}
        >
          <span
            className="font-[family-name:var(--font-dm-mono)] text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: 'var(--ink3)' }}
          >
            Numeric hypothesis
          </span>
          <span className="text-[12px]" style={{ color: 'var(--ink2)' }}>
            {interaction.metric}
            {interaction.unit ? ` (${interaction.unit})` : ''}
          </span>
          <input
            type="number"
            value={hypothesisValue}
            onChange={event => setHypothesisValue(event.target.value)}
            className="rounded-[var(--r-sm)] border bg-[var(--surface)] px-2 py-1.5 text-[12px] outline-none placeholder:text-[color:var(--ink3)] focus:border-[color:var(--accent)]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            placeholder="Enter estimate"
          />
          <button
            onClick={submitHypothesis}
            className="rounded-[var(--r-sm)] px-2 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[color:var(--accent-mid)]"
            style={{ background: 'var(--accent)' }}
          >
            Submit hypothesis
          </button>
        </div>
      )}
      {interaction?.kind === 'prediction_sketch' && (
        <button
          onClick={submitPredictionSketch}
          disabled={predictionPoints.length < 2}
          className="absolute bottom-6 right-4 z-20 flex cursor-pointer items-center gap-2 rounded px-[18px] py-2 text-[13px] font-medium tracking-tight text-zinc-950 shadow-[var(--shadow-sm)] transition-[opacity,transform] disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-90 active:scale-[0.97]"
          style={{ background: '#67e8f9' }}
        >
          Submit prediction sketch
        </button>
      )}
      {interaction?.kind === 'click_to_query' && (
        <div className="absolute top-14 right-4 bg-zinc-950/90 border border-blue-400/50 text-blue-100 rounded-lg px-3 py-2 text-xs z-20">
          Click the simulation to focus: {interaction.regions.join(', ')}
        </div>
      )}
    </div>
  )
}
