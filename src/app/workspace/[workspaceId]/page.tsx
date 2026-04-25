'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import SimContainer from '@/components/SimContainer'
import TutorPanel from '@/components/TutorPanel'
import type {
  AgentCmd,
  AppliedToolCall,
  GetWorkspaceResponse,
  IframeMessage,
  Manifest,
  SimEvent,
  TutorMessage,
  DesignDoc,
  GenerateResponse,
} from '@/lib/types'

function toolCallToAgentCmd(toolCall: { toolName: string; input: Record<string, unknown> }): AgentCmd | null {
  switch (toolCall.toolName) {
    case 'lock':
      return { type: 'AGENT_CMD', action: 'lock', target: String(toolCall.input.element_id) }
    case 'unlock':
      return { type: 'AGENT_CMD', action: 'unlock', target: String(toolCall.input.element_id) }
    case 'highlight':
      return { type: 'AGENT_CMD', action: 'highlight', target: String(toolCall.input.element_id) }
    case 'set_param':
      return {
        type: 'AGENT_CMD',
        action: 'set_param',
        target: String(toolCall.input.name),
        value: Number(toolCall.input.value),
      }
    case 'add_annotation':
      return {
        type: 'AGENT_CMD',
        action: 'annotate',
        region: String(toolCall.input.region),
        text: String(toolCall.input.text),
      }
    case 'clear_annotations':
      return { type: 'AGENT_CMD', action: 'clear_annotations' }
    case 'checkpoint':
      return { type: 'AGENT_CMD', action: 'checkpoint' }
    case 'restore':
      return { type: 'AGENT_CMD', action: 'restore', id: String(toolCall.input.id) }
    case 'trigger_event':
      return { type: 'AGENT_CMD', action: 'trigger_event', eventType: String(toolCall.input.type) }
    case 'set_scene':
      return { type: 'AGENT_CMD', action: 'set_scene', config: toolCall.input.config as Record<string, number> }
    default:
      return null
  }
}

const DEV_FIXTURE: GenerateResponse = {
  designDoc: {
    concept: 'projectile motion',
    domain: 'physics',
    renderer: 'p5',
    params: [
      { name: 'launch_angle', range: [0, 90], default: 45, label: 'Launch Angle', unit: '°' },
      { name: 'initial_velocity', range: [1, 50], default: 20, label: 'Initial Velocity', unit: 'm/s' },
      { name: 'gravity', range: [1, 20], default: 9.8, label: 'Gravity', unit: 'm/s²' },
    ],
    episodic: true,
    governing_equations: ['x = v₀·cos(θ)·t', 'y = v₀·sin(θ)·t − ½g·t²'],
    emit_events: ['launch', 'land'],
    register_regions: ['apex', 'landing'],
    initial_staging: { locked: ['gravity'], highlighted: ['launch_angle'] },
    verification: {
      summary: '30° and 60° produce similar ranges; 45° is near maximum range.',
      probes: [
        { id: 'angle_30', description: '30 degrees', params: { launch_angle: 30, initial_velocity: 20, gravity: 9.8 }, expected_metrics: ['range_m'] },
        { id: 'angle_45', description: '45 degrees', params: { launch_angle: 45, initial_velocity: 20, gravity: 9.8 }, expected_metrics: ['range_m'] },
        { id: 'angle_60', description: '60 degrees', params: { launch_angle: 60, initial_velocity: 20, gravity: 9.8 }, expected_metrics: ['range_m'] },
      ],
      invariants: [
        { kind: 'approximately_equal', id: 'range_symmetry', description: '30° and 60° give similar ranges', left_probe: 'angle_30', right_probe: 'angle_60', metric: 'range_m', tolerance_percent: 8 },
        { kind: 'near_maximum', id: 'max_at_45', description: '45° is near maximum range', target_probe: 'angle_45', comparison_probes: ['angle_30', 'angle_60'], metric: 'range_m', tolerance_percent: 5 },
      ],
    },
    socratic_plan: [
      {
        id: 'predict_range',
        learning_goal: 'Commit to an expectation before observing the trajectory.',
        question: 'Before you launch it, what range do you predict at this angle?',
        interaction: { kind: 'numeric_hypothesis', metric: 'range_m', unit: 'm' },
        staging: { lock: ['gravity'], highlight: ['launch_angle'] },
        expected_observation: 'The student records a concrete range estimate.',
        followup_if_correct: 'Ask why that estimate fits the arc they expect.',
        followup_if_surprised: 'Use the mismatch as the next comparison point.',
        exit_condition: 'A range estimate has been submitted.',
      },
      {
        id: 'compare_angles',
        learning_goal: 'Discover that increasing launch angle past 45 degrees can shorten range.',
        question: 'Now drag the angle past 45 degrees. What changes besides height?',
        interaction: { kind: 'manipulate_param', params: ['launch_angle'] },
        staging: { highlight: ['launch_angle'] },
        expected_observation: 'The path gets taller while range eventually decreases.',
        followup_if_correct: 'Ask what horizontal velocity lost as angle increased.',
        followup_if_surprised: 'Ask them to compare the landing point with their prediction.',
        exit_condition: 'The launch angle has been changed and the landing point observed.',
      },
      {
        id: 'inspect_apex',
        learning_goal: 'Connect the apex to vertical velocity reaching zero.',
        question: 'Click the part of the path where the vertical motion changes direction.',
        interaction: { kind: 'click_to_query', regions: ['apex'] },
        staging: { annotate: [{ region: 'apex', text: 'What is vertical velocity here?' }] },
        expected_observation: 'The student focuses on the apex region.',
        followup_if_correct: 'Ask what horizontal velocity is still doing at the apex.',
        followup_if_surprised: 'Ask which velocity component changed direction there.',
        exit_condition: 'The apex region has been selected.',
      },
    ],
  },
  simCode: `
const getAngle    = runtime.registerParam('launch_angle',     { min: 0,  max: 90, default: 45,  label: 'Launch Angle',    unit: '°',    step: 1   })
const getVelocity = runtime.registerParam('initial_velocity', { min: 1,  max: 50, default: 20,  label: 'Initial Velocity', unit: 'm/s',  step: 0.5 })
const getGravity  = runtime.registerParam('gravity',          { min: 1,  max: 20, default: 9.8, label: 'Gravity',          unit: 'm/s²', step: 0.1 })

const regionPositions = {
  apex: { x: 0, y: 0 },
  landing: { x: 0, y: 0 },
}

runtime.registerRegion('apex', { getPosition: () => regionPositions.apex })
runtime.registerRegion('landing', { getPosition: () => regionPositions.landing })
runtime.registerEvent('launch')
runtime.registerEvent('land')

new p5(function(p) {
  const SCALE = 8
  const OX    = 80
  let simT    = 0
  let lastMs  = 0

  p.setup = function() {
    p.createCanvas(p.windowWidth, p.windowHeight)
    p.textFont('monospace')
    p.textSize(11)
    lastMs = p.millis()
  }

  p.windowResized = function() {
    p.resizeCanvas(p.windowWidth, p.windowHeight)
  }

  p.draw = function() {
    p.background(10)

    const angle = getAngle() * Math.PI / 180
    const v0    = getVelocity()
    const g     = getGravity()
    const OY    = p.height - 80

    const T = (2 * v0 * Math.sin(angle)) / g
    const R = v0 * Math.cos(angle) * T

    const now = p.millis()
    simT += (now - lastMs) / 1000
    lastMs = now
    if (simT > T + 0.4) simT = 0

    p.stroke(55)
    p.strokeWeight(1)
    p.line(OX - 20, OY, OX + R * SCALE + 60, OY)

    p.stroke(255, 160, 60, 80)
    p.strokeWeight(1.5)
    p.noFill()
    p.beginShape()
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * T
      p.vertex(OX + v0 * Math.cos(angle) * t * SCALE, OY - (v0 * Math.sin(angle) * t - 0.5 * g * t * t) * SCALE)
    }
    p.endShape()

    if (simT >= 0 && simT <= T) {
      const bx = OX + v0 * Math.cos(angle) * simT * SCALE
      const by = OY - (v0 * Math.sin(angle) * simT - 0.5 * g * simT * simT) * SCALE
      p.fill(255, 220, 100)
      p.noStroke()
      p.circle(bx, by, 14)
    }

    const tApex = v0 * Math.sin(angle) / g
    const apexX = OX + v0 * Math.cos(angle) * tApex * SCALE
    const apexY = OY - (v0 * Math.sin(angle) * tApex - 0.5 * g * tApex * tApex) * SCALE
    regionPositions.apex = { x: apexX, y: apexY }
    p.fill(100, 180, 255)
    p.noStroke()
    p.circle(apexX, apexY, 7)
    p.fill(100, 180, 255, 180)
    p.text('apex', apexX + 6, apexY - 4)

    const landX = OX + R * SCALE
    regionPositions.landing = { x: landX, y: OY }
    p.fill(100, 255, 140)
    p.noStroke()
    p.circle(landX, OY, 7)
    p.fill(100, 255, 140, 180)
    p.text('R = ' + R.toFixed(1) + ' m', landX + 6, OY - 4)

    p.fill(220)
    p.noStroke()
    p.circle(OX, OY, 10)

    p.stroke(200, 200, 200, 70)
    p.strokeWeight(1)
    p.noFill()
    p.arc(OX, OY, 52, 52, -angle, 0)
    p.noStroke()
    p.fill(200, 200, 200, 160)
    p.text(getAngle().toFixed(0) + '°', OX + 30, OY - 8)
  }
})
`,
  verification: {
    passed: true,
    checks: [
      { invariantId: 'range_symmetry', passed: true, message: '30° and 60° give similar ranges: dev fixture', observed: { left: 34.3, right: 34.3 } },
      { invariantId: 'max_at_45', passed: true, message: '45° is near maximum range: dev fixture', observed: { angle_45: 40.8, angle_30: 34.3, angle_60: 34.3 } },
    ],
    probeResults: [],
  },
  retries: 0,
  fromTemplate: false,
}

function getSessionId(): string {
  let id = localStorage.getItem('sessionId')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('sessionId', id)
  }
  return id
}

function TopBar({ concept }: { concept: string }) {
  return (
    <div className="h-11 flex items-center px-4 gap-3 bg-zinc-900 border-b border-zinc-800 shrink-0 z-10">
      <span className="text-sm font-semibold text-zinc-100">Praxio</span>
      <div className="w-px h-4 bg-zinc-700" />
      <span className="text-sm text-zinc-400 flex-1 truncate">{concept}</span>
      <span className="text-xs font-mono text-zinc-500 bg-zinc-800 border border-zinc-700 rounded-full px-2.5 py-0.5">
        ◆ main · cp 0
      </span>
    </div>
  )
}

function SocraticPlanPanel({
  designDoc,
  activeStepId,
  onSelectStep,
}: {
  designDoc: DesignDoc | null
  activeStepId: string | null
  onSelectStep: (stepId: string) => void
}) {
  const plan = designDoc?.socratic_plan || []
  const activeStep = plan.find(step => step.id === activeStepId) || plan[0]

  if (!activeStep) return null

  return (
    <div className="absolute top-4 right-4 z-20 w-80 rounded-xl border border-zinc-700/70 bg-zinc-950/90 backdrop-blur p-4 shadow-2xl">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Socratic step</span>
        <select
          value={activeStep.id}
          onChange={event => onSelectStep(event.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
        >
          {plan.map((step, index) => (
            <option key={step.id} value={step.id}>
              {index + 1}. {step.id}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm text-zinc-100 leading-snug">{activeStep.question}</p>
      <p className="mt-2 text-xs text-zinc-500">{activeStep.learning_goal}</p>
      <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-400">
        <span>{activeStep.interaction.kind}</span>
        <span>{activeStep.exit_condition}</span>
      </div>
    </div>
  )
}

export default function WorkspacePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const [simCode, setSimCode] = useState<string | null>(null)
  const [renderer, setRenderer] = useState<'p5' | 'canvas2d' | 'jsxgraph' | 'matter' | null>(null)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [designDoc, setDesignDoc] = useState<DesignDoc | null>(null)
  const [messages, setMessages] = useState<TutorMessage[]>([])
  const [pendingEvents, setPendingEvents] = useState<SimEvent[]>([])
  const [agentCommands, setAgentCommands] = useState<AgentCmd[]>([])
  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [sessionId] = useState(() => typeof window === 'undefined' ? 'demo' : getSessionId())

  useEffect(() => {
    if (workspaceId === 'dev') {
      const data = DEV_FIXTURE
      queueMicrotask(() => {
        setDesignDoc(data.designDoc)
        setActiveStepId(data.designDoc.socratic_plan[0]?.id || null)
        setPendingEvents([])
        setAgentCommands([])
        setManifest(null)
        setSimCode(data.simCode)
        setRenderer(data.designDoc.renderer)
      })
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}?sessionId=${encodeURIComponent(sessionId)}`,
        )
        if (res.ok) {
          const payload = (await res.json()) as GetWorkspaceResponse
          if (cancelled) return
          const w = payload.workspace
          setDesignDoc(w.designDoc)
          setManifest(null)
          setSimCode(w.simCode)
          setRenderer(w.renderer)
          setActiveStepId(
            payload.branch?.currentSocraticStepId
              ?? w.designDoc.socratic_plan[0]?.id
              ?? null,
          )
          if (payload.branch?.conversationHistory?.length) {
            setMessages(payload.branch.conversationHistory)
          }
          setPendingEvents([])
          setAgentCommands([])
          return
        }
      } catch {
        /* sessionStorage fallback */
      }
      const raw = sessionStorage.getItem(`workspace:${workspaceId}`)
      const data: GenerateResponse | null = raw ? JSON.parse(raw) as GenerateResponse : null
      if (!data || cancelled) return
      queueMicrotask(() => {
        setDesignDoc(data.designDoc)
        setActiveStepId(data.designDoc.socratic_plan[0]?.id || null)
        setPendingEvents([])
        setAgentCommands([])
        setManifest(null)
        setSimCode(data.simCode)
        setRenderer(data.designDoc.renderer)
      })
    })()

    return () => {
      cancelled = true
    }
  }, [workspaceId, sessionId])

  const handleManifest = useCallback((m: Manifest) => {
    setManifest(m)
  }, [])

  const sandboxLoading = simCode != null && manifest == null

  const handleIframeMessage = useCallback((msg: IframeMessage) => {
    console.log('[iframe]', msg)
    if (msg.type === 'PARAM_CHANGED') {
      setPendingEvents(prev => [...prev, {
        event: 'param_changed',
        param: msg.param,
        from: msg.from,
        to: msg.to,
        sim_state: msg.sim_state,
        timestamp: Date.now(),
      }])
    }
    if (msg.type === 'SIM_EVENT') {
      setPendingEvents(prev => [...prev, {
        event: msg.event,
        payload: msg.payload,
        timestamp: msg.timestamp,
      }])
    }
  }, [])

  const handleStepEvent = useCallback((event: SimEvent) => {
    setPendingEvents(prev => [...prev, event])
  }, [])

  const handleSend = async (text: string) => {
    if (!manifest || !designDoc) return
    const next: TutorMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    const events = pendingEvents
    setPendingEvents([])
    setIsSpeaking(true)

    const stageBody = {
      messages: next,
      pendingEvents: events,
      manifest,
      designDoc,
      sessionId,
      workspaceId: workspaceId === 'dev' ? 'dev' : workspaceId,
      activeSocraticStepId: activeStepId || undefined,
    }

    const stageRes = await fetch('/api/tutor/stage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stageBody),
    })
    const stageData = await stageRes.json() as { toolCalls: Array<{ toolName: string; input: Record<string, unknown> }> }
    const appliedToolCalls: AppliedToolCall[] = stageData.toolCalls.map(toolCall => ({
      ...toolCall,
      result: null,
    }))
    const commands = stageData.toolCalls
      .map(toolCallToAgentCmd)
      .filter((cmd): cmd is AgentCmd => Boolean(cmd))
    setAgentCommands(prev => [...prev, ...commands])

    const speakRes = await fetch('/api/tutor/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...stageBody, appliedToolCalls }),
    })
    const reader = speakRes.body!.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      fullText += decoder.decode(value, { stream: true })
      setMessages([...next, { role: 'assistant', content: fullText }])
    }
    setIsSpeaking(false)
  }

  const activeStep = designDoc?.socratic_plan.find(step => step.id === activeStepId) || null

  return (
    <div className="relative flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {sandboxLoading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950/95 text-zinc-100 gap-3">
          <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
          <p className="text-sm text-zinc-300">Sandbox load — starting simulation runtime</p>
          <p className="text-xs text-zinc-600 max-w-sm text-center">Waiting for manifest from iframe (sim module executed).</p>
        </div>
      )}
      <TopBar concept={designDoc?.concept ?? ''} />
      <div className="flex-1 relative min-h-0">
        <SocraticPlanPanel
          designDoc={designDoc}
          activeStepId={activeStepId}
          onSelectStep={setActiveStepId}
        />
        <SimContainer
          simCode={simCode}
          renderer={renderer}
          activeStep={activeStep}
          agentCommands={agentCommands}
          onManifest={handleManifest}
          onMessage={handleIframeMessage}
          onStepEvent={handleStepEvent}
        />
      </div>
      <TutorPanel
        messages={messages}
        onSend={handleSend}
        isSpeaking={isSpeaking}
      />
    </div>
  )
}
