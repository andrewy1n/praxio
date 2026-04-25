'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IframeMessage, AgentCmd, Manifest, SimEvent, SocraticStep } from '@/lib/types'

type Props = {
  simCode: string | null
  renderer: 'p5' | 'canvas2d' | 'jsxgraph' | 'matter' | null
  onManifest: (manifest: Manifest) => void
  onMessage: (msg: IframeMessage) => void
  activeStep?: SocraticStep | null
  onStepEvent?: (event: SimEvent) => void
  agentCommands?: AgentCmd[]
}

export default function SimContainer({
  simCode,
  renderer,
  onManifest,
  onMessage,
  activeStep = null,
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
  const [regionPositions, setRegionPositions] = useState<Record<string, { x: number; y: number }>>({})
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
    activeStep.staging.annotate?.forEach(({ region, text }) => {
      sendCmd({ type: 'AGENT_CMD', action: 'annotate', region, text })
    })
    Object.entries(activeStep.staging.set_params || {}).forEach(([target, value]) => {
      setParamValues(prev => ({ ...prev, [target]: value }))
      sendCmd({ type: 'AGENT_CMD', action: 'set_param', target, value })
    })
  }, [activeStep, sendCmd])

  useEffect(() => {
    sendCmd({
      type: 'TRACK_REGIONS',
      enabled: interaction?.kind === 'click_to_query' || Boolean(staging?.annotate?.length),
    })
  }, [interaction?.kind, staging?.annotate?.length, sendCmd])

  const handleSlider = (name: string, value: number) => {
    setParamValues(prev => ({ ...prev, [name]: value }))
    sendCmd({ type: 'AGENT_CMD', action: 'set_param', target: name, value })
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
    emitStepEvent({
      event: 'prediction_sketch_submitted',
      payload: {
        points: predictionPoints.map(point => ({ x: Math.round(point.x), y: Math.round(point.y) })),
        coordinate_space: 'iframe_css_pixels',
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
        <div className="absolute top-14 left-4 w-52 bg-zinc-950/85 backdrop-blur border border-zinc-700/60 rounded-lg px-4 py-3 flex flex-col gap-4 z-10">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">parameters</span>
          {manifest.params.map(param => (
            <div
              key={param.name}
              className={`flex flex-col gap-1.5 rounded-md border p-2 ${
                highlightedParams.has(param.name)
                  ? 'border-yellow-400/70 bg-yellow-400/10'
                  : 'border-transparent'
              } ${lockedParams.has(param.name) ? 'opacity-50' : ''}`}
            >
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">{param.label}</span>
                <span className="tabular-nums text-zinc-200 font-mono">
                  {(paramValues[param.name] ?? param.default).toFixed(1)}
                  {param.unit ? ` ${param.unit}` : ''}
                </span>
              </div>
              <input
                type="range"
                min={param.min}
                max={param.max}
                step={(param.max - param.min) / 100}
                value={paramValues[param.name] ?? param.default}
                onChange={e => handleSlider(param.name, parseFloat(e.target.value))}
                disabled={lockedParams.has(param.name)}
                className="w-full accent-orange-400"
              />
            </div>
          ))}
        </div>
      )}
      {interaction?.kind === 'numeric_hypothesis' && (
        <div className="absolute top-14 right-4 w-64 bg-zinc-950/90 backdrop-blur border border-zinc-700 rounded-lg p-3 z-20 flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">numeric hypothesis</span>
          <span className="text-xs text-zinc-300">
            {interaction.metric}{interaction.unit ? ` (${interaction.unit})` : ''}
          </span>
          <input
            type="number"
            value={hypothesisValue}
            onChange={event => setHypothesisValue(event.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
            placeholder="Enter estimate"
          />
          <button onClick={submitHypothesis} className="bg-orange-400 text-zinc-950 rounded px-2 py-1 text-xs">
            Submit hypothesis
          </button>
        </div>
      )}
      {interaction?.kind === 'prediction_sketch' && (
        <button
          onClick={submitPredictionSketch}
          disabled={predictionPoints.length < 2}
          className="absolute top-14 right-4 bg-cyan-300 disabled:opacity-40 text-zinc-950 rounded px-3 py-2 text-xs z-20"
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
