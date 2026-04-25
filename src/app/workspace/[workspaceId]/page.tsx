'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import SimContainer from '@/components/SimContainer'
import WorkspaceTopBar from '@/components/workspace/WorkspaceTopBar'
import WorkspaceTutorStrip from '@/components/workspace/WorkspaceTutorStrip'
import type { TutorStripState } from '@/components/workspace/WorkspaceTutorStrip'
import SimControlsOverlay from '@/components/SimControlsOverlay'
import type {
  AgentCmd,
  AppliedToolCall,
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

async function loadProjectileMotionPreset(): Promise<{ designDoc: DesignDoc; simCode: string }> {
  const [designDocRes, simRes] = await Promise.all([
    fetch('/presets/projectile-motion/design-doc.json'),
    fetch('/presets/projectile-motion/sim.js'),
  ])
  if (!designDocRes.ok) throw new Error(`Failed to load design doc: ${designDocRes.status}`)
  if (!simRes.ok) throw new Error(`Failed to load sim: ${simRes.status}`)
  const designDoc = await designDocRes.json() as DesignDoc
  const simCode = await simRes.text()
  return { designDoc, simCode }
}

function getSessionId(): string {
  let id = localStorage.getItem('sessionId')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('sessionId', id)
  }
  return id
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
  const [completedStepIds, setCompletedStepIds] = useState<string[]>([])
  const [tutorState, setTutorState] = useState<TutorStripState>('idle')
  const [simPhase, setSimPhase] = useState<'idle' | 'active' | 'done'>('idle')
  const [paused, setPaused] = useState(false)
  const [simEventHint, setSimEventHint] = useState<string | null>(null)
  const [sessionId] = useState(() => typeof window === 'undefined' ? 'demo' : getSessionId())
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const tutorTurnInFlightRef = useRef(false)

  const advanceStep = useCallback(() => {
    if (!designDoc?.socratic_plan?.length) return
    const plan = designDoc.socratic_plan
    const currentIdx = activeStepId ? plan.findIndex(s => s.id === activeStepId) : -1
    const nextId = currentIdx >= 0 ? (plan[currentIdx + 1]?.id ?? null) : (plan[0]?.id ?? null)
    if (nextId) setActiveStepId(nextId)
  }, [activeStepId, designDoc])

  const stopTutorAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.src = ''
    audioRef.current = null
  }, [])

  const speakTutorText = useCallback(async (text: string) => {
    const prompt = text.trim()
    if (!prompt) return

    stopTutorAudio()

    const ttsRes = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: prompt }),
    })

    if (!ttsRes.ok) {
      const debug = await ttsRes.text().catch(() => '')
      console.warn('[tts] failed', { status: ttsRes.status, debug })
      return
    }

    const audioBlob = await ttsRes.blob()
    const url = URL.createObjectURL(audioBlob)
    const audio = new Audio(url)
    audioRef.current = audio

    const cleanup = () => {
      if (audioRef.current === audio) audioRef.current = null
      URL.revokeObjectURL(url)
    }

    audio.onended = cleanup
    audio.onerror = cleanup

    try {
      await audio.play()
    } catch (err) {
      console.warn('[tts] playback blocked or failed', err)
      cleanup()
    }
  }, [stopTutorAudio])

  const runTutorTurn = useCallback(async (args: {
    nextMessages: TutorMessage[]
    events: SimEvent[]
  }) => {
    if (!manifest || !designDoc) return
    if (tutorTurnInFlightRef.current) return
    tutorTurnInFlightRef.current = true

    try {
      stopTutorAudio()
      setTutorState('processing')

      const stageBody = {
        messages: args.nextMessages,
        pendingEvents: args.events,
        manifest,
        designDoc,
        sessionId,
        activeSocraticStepId: activeStepId || undefined,
      }

      const stageRes = await fetch('/api/tutor/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stageBody),
      })
      if (!stageRes.ok) {
        console.warn('[tutor] stage failed', { status: stageRes.status, body: await stageRes.text().catch(() => '') })
        setTutorState('idle')
        return
      }

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
      if (!speakRes.ok) {
        console.warn('[tutor] speak failed', { status: speakRes.status, body: await speakRes.text().catch(() => '') })
        setTutorState('idle')
        return
      }

      const tutorText = await speakRes.text()
      setMessages([...args.nextMessages, { role: 'assistant', content: tutorText }])

      setTutorState('tutor speaking')
      await speakTutorText(tutorText)
      setTutorState('idle')
    } finally {
      tutorTurnInFlightRef.current = false
    }
  }, [activeStepId, designDoc, manifest, sessionId, speakTutorText, stopTutorAudio])

  const enqueueAgentCmd = useCallback((cmd: AgentCmd) => {
    setAgentCommands(prev => [...prev, cmd])
  }, [])

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        if (workspaceId === 'dev') {
          const { designDoc, simCode } = await loadProjectileMotionPreset()
          if (cancelled) return
          setDesignDoc(designDoc)
          setActiveStepId(designDoc.socratic_plan[0]?.id || null)
          setPendingEvents([])
          setAgentCommands([])
          setSimCode(simCode)
          setRenderer(designDoc.renderer)
          setTutorState('idle')
          setSimEventHint(null)
          setSimPhase('idle')
          setPaused(false)
          return
        }

        const raw = sessionStorage.getItem(`workspace:${workspaceId}`)
        const data = raw ? (JSON.parse(raw) as GenerateResponse) : null
        if (!data || cancelled) return
        setDesignDoc(data.designDoc)
        setActiveStepId(data.designDoc.socratic_plan[0]?.id || null)
        setPendingEvents([])
        setAgentCommands([])
        setSimCode(data.simCode)
        setRenderer(data.designDoc.renderer)
        setTutorState('idle')
        setSimEventHint(null)
        setSimPhase('idle')
        setPaused(false)
      } catch (err) {
        console.error(err)
      }
    }

    void run()
    return () => { cancelled = true }
  }, [workspaceId])

  useEffect(() => {
    return () => {
      stopTutorAudio()
    }
  }, [stopTutorAudio])

  const handleManifest = useCallback((m: Manifest) => setManifest(m), [])

  const handleIframeMessage = useCallback((msg: IframeMessage) => {
    console.log('[iframe]', msg)
    if (msg.type === 'PARAM_CHANGED') {
      setSimEventHint(`↳ param_changed: ${msg.param} ${msg.from}→${msg.to}`)
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
      setSimEventHint(`↳ ${msg.event}`)
      setPendingEvents(prev => [...prev, {
        event: msg.event,
        payload: msg.payload,
        timestamp: msg.timestamp,
      }])
    }
    if (msg.type === 'SIM_PHASE') {
      setSimPhase(msg.phase)
      if (msg.phase !== 'active') setPaused(false)
    }
    if (msg.type === 'SIM_PAUSED') setPaused(true)
    if (msg.type === 'SIM_RESUMED') setPaused(false)
  }, [])

  const handleStepEvent = useCallback((event: SimEvent) => {
    // Treat explicit student submissions (sketch/hypothesis/focus) as a tutor turn trigger.
    if (event.event === 'prediction_sketch_submitted'
      || event.event === 'hypothesis_submitted'
      || event.event === 'focus_selected') {
      if (activeStepId) {
        setCompletedStepIds(prev => prev.includes(activeStepId) ? prev : [...prev, activeStepId])
      }
      advanceStep()
      const events = [event]
      setPendingEvents([])
      void runTutorTurn({ nextMessages: messages, events })
      return
    }

    setPendingEvents(prev => [...prev, event])
  }, [activeStepId, advanceStep, messages, runTutorTurn])

  const handleSend = async (text: string) => {
    const next: TutorMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    const events = pendingEvents
    setPendingEvents([])
    await runTutorTurn({ nextMessages: next, events })
  }

  const activeStep = designDoc?.socratic_plan.find(step => step.id === activeStepId) || null

  return (
    <div className="relative flex h-screen flex-col overflow-hidden text-[color:var(--ink)]">
      {/* Sim canvas (tokens.md): full viewport behind top bar + sim stack + tutor strip */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 praxio-workspace-sim-canvas"
      />

      <WorkspaceTopBar
        conceptTitle={designDoc?.concept ?? ''}
        socraticSteps={(designDoc?.socratic_plan ?? []).map(step => ({ id: step.id }))}
        activeStepId={activeStepId}
        completedStepIds={completedStepIds}
        onSelectStep={setActiveStepId}
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
        <SimContainer
          simCode={simCode}
          renderer={renderer}
          activeStep={activeStep}
          agentCommands={agentCommands}
          onManifest={handleManifest}
          onMessage={handleIframeMessage}
          onStepEvent={handleStepEvent}
        />

        {activeStep?.question ? (
          <div className="pointer-events-none absolute left-4 right-4 top-4 z-20 flex">
            {/* Spacer for ParamPanel (top-left) so the question sits to its right */}
            <div className="w-[260px] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="mx-auto max-w-[var(--measure-lg)] text-center">
                <div
                  className="inline-block rounded-[var(--r)] border bg-white/90 px-4 py-2 text-[14px] leading-[1.45] tracking-tight text-[color:var(--ink)] shadow-[var(--shadow-md)] backdrop-blur"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {activeStep.question}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {manifest ? (
          <SimControlsOverlay
            manifest={manifest}
            phase={simPhase}
            paused={paused}
            onLaunch={() => enqueueAgentCmd({ type: 'AGENT_CMD', action: 'launch' })}
            onPause={() => enqueueAgentCmd({ type: 'AGENT_CMD', action: 'pause' })}
            onPlay={() => enqueueAgentCmd({ type: 'AGENT_CMD', action: 'play' })}
            onReset={() => enqueueAgentCmd({ type: 'AGENT_CMD', action: 'reset' })}
          />
        ) : null}
      </div>

      <WorkspaceTutorStrip
        messages={messages}
        onSend={handleSend}
        tutorState={tutorState}
        simEventHint={simEventHint}
        showSimHint
      />
    </div>
  )
}
