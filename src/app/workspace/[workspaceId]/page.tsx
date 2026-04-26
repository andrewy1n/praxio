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
  GetWorkspaceResponse,
  IframeMessage,
  Manifest,
  SimEvent,
  TutorMessage,
  DesignDoc,
  GenerateResponse,
} from '@/lib/types'

// Preferred MediaRecorder mime types, in order. Browsers fall through to the
// first one they actually support (Safari needs mp4/aac, Chrome/Firefox prefer
// webm/opus). ElevenLabs Scribe auto-detects codec from the file payload.
const MIC_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

function pickSupportedMimeType(): string | undefined {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return undefined
  }
  for (const type of MIC_MIME_CANDIDATES) {
    try {
      if (window.MediaRecorder.isTypeSupported?.(type)) return type
    } catch {
      /* ignore */
    }
  }
  return undefined
}

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
    case 'advance_step':
      // Handled client-side only (not a sim command).
      return null
    case 'launch':
      return { type: 'AGENT_CMD', action: 'launch' }
    default:
      return null
  }
}

async function loadPreset(id: string): Promise<{ designDoc: DesignDoc; simCode: string }> {
  const [designDocRes, simRes] = await Promise.all([
    fetch(`/presets/${id}/design-doc.json`),
    fetch(`/presets/${id}/sim.js`),
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
  // Mirror tutorState into a ref so non-React listeners (gesture unlock) can
  // check the current state without triggering re-registrations on every change.
  const tutorStateRef = useRef<TutorStripState>('idle')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const micCancelledRef = useRef(false)
  // Mirror activeStepId into a ref so runTutorTurn can detect mid-turn
  // dropdown switches (closure captures a stale activeStepId).
  const activeStepIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeStepIdRef.current = activeStepId
  }, [activeStepId])
  useEffect(() => {
    tutorStateRef.current = tutorState
  }, [tutorState])
  // Auto-read the step question on entry (initial load, dropdown switch). When
  // the tutor itself triggers the advance, its Call 2 speech already covers
  // the transition — we flip skipNextAutoReadRef so we don't speak twice.
  const skipNextAutoReadRef = useRef(false)
  const autoReadStepIdRef = useRef<string | null>(null)
  // Browser autoplay policy: audio cannot play before the first user gesture.
  // If auto-read fires on page load, stash the question here and replay on
  // the first click/keydown.
  const pendingAutoReadRef = useRef<{ stepId: string; text: string } | null>(null)
  /** Step id whose question was heard via entry TTS — next user turn should not parrot it in Call 2. */
  const stepQuestionReadAloudRef = useRef<string | null>(null)

  useEffect(() => {
    autoReadStepIdRef.current = null
    stepQuestionReadAloudRef.current = null
    pendingAutoReadRef.current = null
    skipNextAutoReadRef.current = false
  }, [workspaceId])

  // Mark a specific step complete and move to the next one, guarded against the
  // student having manually switched steps via the dropdown mid-turn. This is
  // the ONLY path that advances steps during a session — it fires when the
  // tutor calls the advance_step tool in its Call 1 staging response.
  const completeAndAdvanceFrom = useCallback((stepId: string) => {
    const plan = designDoc?.socratic_plan ?? []
    if (!plan.length) return
    const idx = plan.findIndex(s => s.id === stepId)
    const nextId = idx >= 0 ? plan[idx + 1]?.id ?? null : null
    console.log('[tutor] advance_step:', stepId, '->', nextId ?? '(end of plan)')
    // Tutor's Call 2 response speaks the transition; skip the next auto-read
    // so we don't overlap its speech with the raw step question.
    skipNextAutoReadRef.current = true
    setCompletedStepIds(prev => (prev.includes(stepId) ? prev : [...prev, stepId]))
    setActiveStepId(current => {
      if (current !== stepId) return current
      if (idx < 0) return current
      return plan[idx + 1]?.id ?? current
    })
  }, [designDoc])

  const stopTutorAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.src = ''
    audioRef.current = null
  }, [])

  const speakTutorText = useCallback(async (text: string): Promise<{ ok: boolean; blocked: boolean }> => {
    const prompt = text.trim()
    if (!prompt) return { ok: false, blocked: false }

    stopTutorAudio()

    const ttsRes = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: prompt }),
    })

    if (!ttsRes.ok) {
      const debug = await ttsRes.text().catch(() => '')
      console.warn('[tts] failed', { status: ttsRes.status, debug })
      return { ok: false, blocked: false }
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
      return { ok: true, blocked: false }
    } catch (err) {
      const blocked = err instanceof DOMException && err.name === 'NotAllowedError'
      console.warn('[tts] playback blocked or failed', err)
      cleanup()
      return { ok: false, blocked }
    }
  }, [stopTutorAudio])

  const runTutorTurn = useCallback(async (args: {
    nextMessages: TutorMessage[]
    events: SimEvent[]
    /**
     * The step id the student's action is being evaluated against. If the
     * tutor signals advance_step in this turn, the page advances from this
     * step (and only if the student is still on it when the turn finishes).
     */
    submittedStepId?: string | null
  }) => {
    if (!designDoc) {
      console.warn('[tutor] designDoc not ready yet')
      return
    }
    if (!manifest) {
      console.warn('[tutor] manifest not ready yet (iframe has not sent MANIFEST)')
      return
    }
    if (tutorTurnInFlightRef.current) {
      console.warn('[tutor] turn already in flight; ignoring new request')
      return
    }
    tutorTurnInFlightRef.current = true

    try {
      stopTutorAudio()
      setTutorState('processing')

      const stepQuestionReadAloud = Boolean(
        args.submittedStepId
        && stepQuestionReadAloudRef.current
        && stepQuestionReadAloudRef.current === args.submittedStepId,
      )

      const stageBody = {
        messages: args.nextMessages,
        pendingEvents: args.events,
        manifest,
        designDoc,
        sessionId,
        workspaceId: workspaceId === 'dev' ? 'dev' : workspaceId,
        activeSocraticStepId: activeStepId || undefined,
        stepQuestionReadAloud,
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
      console.log('[tutor] stage tools:', stageData.toolCalls.map(tc => tc.toolName), {
        activeStep: args.submittedStepId,
      })

      // The tutor signals step completion by calling the advance_step tool.
      // Split it out: it's not a sim command and we do not want it in Call 2's
      // staging summary (it just nudges the tutor to "ask the next question"
      // mid-sentence).
      const tutorRequestedAdvance = stageData.toolCalls.some(tc => tc.toolName === 'advance_step')
      const stagingToolCalls = stageData.toolCalls.filter(tc => tc.toolName !== 'advance_step')

      const appliedToolCalls: AppliedToolCall[] = stagingToolCalls.map(toolCall => ({
        ...toolCall,
        result: null,
      }))
      const commands = stagingToolCalls
        .map(toolCallToAgentCmd)
        .filter((cmd): cmd is AgentCmd => Boolean(cmd))
      setAgentCommands(prev => [...prev, ...commands])

      // If the tutor signaled advance, transition the UI and the step id
      // handed to Call 2 BEFORE speaking, so the banner and the tutor's
      // words refer to the same step. Skip if the student dropdown-switched
      // mid-turn (read the ref, not the stale closure value).
      let speakStepId: string | null | undefined = activeStepIdRef.current
      if (tutorRequestedAdvance && args.submittedStepId) {
        const plan = designDoc.socratic_plan
        const idx = plan.findIndex(s => s.id === args.submittedStepId)
        const nextStepId = idx >= 0 ? plan[idx + 1]?.id ?? null : null
        if (nextStepId && activeStepIdRef.current === args.submittedStepId) {
          speakStepId = nextStepId
          completeAndAdvanceFrom(args.submittedStepId)
        }
      }

      const speakRes = await fetch('/api/tutor/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...stageBody,
          activeSocraticStepId: speakStepId || undefined,
          appliedToolCalls,
        }),
      })
      if (!speakRes.ok) {
        console.warn('[tutor] speak failed', { status: speakRes.status, body: await speakRes.text().catch(() => '') })
        setTutorState('idle')
        return
      }

      const nextAssistantBase: TutorMessage[] = [...args.nextMessages]
      let tutorText = ''
      if (speakRes.body) {
        const reader = speakRes.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          tutorText += decoder.decode(value, { stream: true })
          setMessages([...nextAssistantBase, { role: 'assistant', content: tutorText }])
        }
        tutorText += decoder.decode()
      } else {
        tutorText = await speakRes.text()
      }

      setMessages([...nextAssistantBase, { role: 'assistant', content: tutorText }])

      if (stepQuestionReadAloud) {
        stepQuestionReadAloudRef.current = null
      }

      setTutorState('tutor speaking')
      await speakTutorText(tutorText)
      setTutorState('idle')
    } finally {
      tutorTurnInFlightRef.current = false
    }
  }, [activeStepId, completeAndAdvanceFrom, designDoc, manifest, sessionId, speakTutorText, stopTutorAudio, workspaceId])

  const enqueueAgentCmd = useCallback((cmd: AgentCmd) => {
    setAgentCommands(prev => [...prev, cmd])
  }, [])

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        if (workspaceId === 'demo') {
          const { designDoc, simCode } = await loadPreset('projectile-motion-demo')
          if (cancelled) return
          setDesignDoc(designDoc)
          setActiveStepId(designDoc.socratic_plan[0]?.id || null)
          setPendingEvents([])
          setAgentCommands([])
          setManifest(null)
          setSimCode(simCode)
          setRenderer(designDoc.renderer)
          setTutorState('idle')
          setSimEventHint(null)
          setSimPhase('idle')
          setPaused(false)
          return
        }

        if (workspaceId === 'dev') {
          const { designDoc, simCode } = await loadPreset('projectile-motion')
          if (cancelled) return
          setDesignDoc(designDoc)
          setActiveStepId(designDoc.socratic_plan[0]?.id || null)
          setPendingEvents([])
          setAgentCommands([])
          setManifest(null)
          setSimCode(simCode)
          setRenderer(designDoc.renderer)
          setTutorState('idle')
          setSimEventHint(null)
          setSimPhase('idle')
          setPaused(false)
          return
        }

        try {
          const res = await fetch(
            `/api/workspaces/${encodeURIComponent(workspaceId)}?sessionId=${encodeURIComponent(sessionId)}`,
          )
          if (res.ok) {
            const payload = (await res.json()) as GetWorkspaceResponse
            if (cancelled) return
            const w = payload.workspace
            setDesignDoc(w.designDoc)
            setActiveStepId(
              payload.branch?.currentSocraticStepId
                ?? w.designDoc.socratic_plan[0]?.id
                ?? null,
            )
            setCompletedStepIds(w.completedStepIds ?? [])
            if (payload.branch?.conversationHistory?.length) {
              setMessages(payload.branch.conversationHistory)
            }
            setPendingEvents([])
            setAgentCommands([])
            setManifest(null)
            setSimCode(w.simCode)
            setRenderer(w.renderer)
            setTutorState('idle')
            setSimEventHint(null)
            setSimPhase('idle')
            setPaused(false)
            return
          }
        } catch {
          /* fall through to sessionStorage */
        }

        const raw = sessionStorage.getItem(`workspace:${workspaceId}`)
        const data: GenerateResponse | null = raw ? JSON.parse(raw) as GenerateResponse : null
        if (!data || cancelled) return
        setDesignDoc(data.designDoc)
        setActiveStepId(data.designDoc.socratic_plan[0]?.id || null)
        setPendingEvents([])
        setAgentCommands([])
        setManifest(null)
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
  }, [workspaceId, sessionId])

  useEffect(() => {
    return () => {
      stopTutorAudio()
    }
  }, [stopTutorAudio])

  const handleManifest = useCallback((m: Manifest) => setManifest(m), [])

  const sandboxLoading = simCode != null && manifest == null

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
    // Explicit student submissions (sketch/hypothesis/focus-click) are forwarded
    // to the tutor so it can evaluate them. They do NOT auto-advance the step —
    // only an advance_step tool call from the tutor advances.
    if (event.event === 'prediction_sketch_submitted'
      || event.event === 'hypothesis_submitted'
      || event.event === 'focus_selected') {
      const events = [event]
      setPendingEvents([])
      void runTutorTurn({
        nextMessages: messages,
        events,
        submittedStepId: activeStepId,
      })
      return
    }

    setPendingEvents(prev => [...prev, event])
  }, [activeStepId, messages, runTutorTurn])

  const handleSend = async (text: string) => {
    if (tutorTurnInFlightRef.current || tutorState !== 'idle') {
      console.warn('[tutor] busy; ignoring send')
      return
    }
    const next: TutorMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    const events = pendingEvents
    setPendingEvents([])
    // Pass the step the student is responding TO so the tutor can advance
    // from it via the advance_step tool. The page does not auto-advance; the
    // tutor decides.
    await runTutorTurn({
      nextMessages: next,
      events,
      submittedStepId: activeStepId,
    })
  }

  const releaseMicStream = useCallback(() => {
    const stream = mediaStreamRef.current
    if (stream) {
      stream.getTracks().forEach(track => {
        try { track.stop() } catch {}
      })
    }
    mediaStreamRef.current = null
    mediaRecorderRef.current = null
    audioChunksRef.current = []
  }, [])

  const transcribeAndSend = useCallback(async (blob: Blob) => {
    if (blob.size === 0) {
      console.warn('[stt] empty audio blob; skipping transcription')
      setTutorState('idle')
      return
    }

    setTutorState('processing')

    try {
      const form = new FormData()
      const filename = blob.type.includes('mp4')
        ? 'speech.mp4'
        : blob.type.includes('ogg')
          ? 'speech.ogg'
          : 'speech.webm'
      form.append('file', blob, filename)

      const res = await fetch('/api/stt', { method: 'POST', body: form })
      if (!res.ok) {
        const debug = await res.text().catch(() => '')
        console.warn('[stt] /api/stt failed', { status: res.status, debug })
        setTutorState('idle')
        return
      }

      const data = await res.json() as { text?: string; rawText?: string; languageCode?: string | null }
      const transcript = typeof data.text === 'string' ? data.text.trim() : ''
      if (!transcript) {
        console.warn('[stt] empty transcript from ElevenLabs', {
          rawText: data.rawText ?? null,
          languageCode: data.languageCode ?? null,
        })
        setTutorState('idle')
        return
      }

      // handleSend moves us from 'processing' through the tutor turn itself; we
      // do NOT revert to idle here, runTutorTurn owns that transition.
      await handleSend(transcript)
    } catch (err) {
      console.warn('[stt] transcription error', err)
      setTutorState('idle')
    }
  }, [handleSend])

  const startMicCapture = useCallback(async () => {
    if (typeof window === 'undefined') return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      console.warn('[stt] getUserMedia not supported in this browser')
      return
    }
    if (typeof window.MediaRecorder === 'undefined') {
      console.warn('[stt] MediaRecorder not supported in this browser')
      return
    }

    stopTutorAudio()

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      console.warn('[stt] microphone permission denied or unavailable', err)
      return
    }

    const mimeType = pickSupportedMimeType()
    let recorder: MediaRecorder
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
    } catch (err) {
      console.warn('[stt] failed to construct MediaRecorder', err)
      stream.getTracks().forEach(t => { try { t.stop() } catch {} })
      return
    }

    mediaStreamRef.current = stream
    mediaRecorderRef.current = recorder
    audioChunksRef.current = []
    micCancelledRef.current = false

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        audioChunksRef.current.push(event.data)
      }
    }

    recorder.onerror = (event: Event) => {
      console.warn('[stt] MediaRecorder error', event)
    }

    recorder.onstop = () => {
      const chunks = audioChunksRef.current
      const type = recorder.mimeType || mimeType || 'audio/webm'
      const cancelled = micCancelledRef.current
      releaseMicStream()

      if (cancelled) {
        setTutorState('idle')
        return
      }

      const blob = new Blob(chunks, { type })
      void transcribeAndSend(blob)
    }

    try {
      recorder.start()
      setTutorState('listening')
    } catch (err) {
      console.warn('[stt] failed to start MediaRecorder', err)
      releaseMicStream()
      setTutorState('idle')
    }
  }, [releaseMicStream, stopTutorAudio, transcribeAndSend])

  const stopMicCapture = useCallback((opts?: { cancel?: boolean }) => {
    const recorder = mediaRecorderRef.current
    if (!recorder) return
    micCancelledRef.current = Boolean(opts?.cancel)
    if (recorder.state !== 'inactive') {
      try { recorder.stop() } catch (err) { console.warn('[stt] recorder.stop failed', err) }
    } else {
      releaseMicStream()
    }
  }, [releaseMicStream])

  const handleMic = useCallback(() => {
    if (tutorTurnInFlightRef.current) return

    if (tutorState === 'listening') {
      stopMicCapture()
      return
    }

    if (tutorState !== 'idle') return
    void startMicCapture()
  }, [startMicCapture, stopMicCapture, tutorState])

  useEffect(() => {
    return () => {
      stopMicCapture({ cancel: true })
    }
  }, [stopMicCapture])

  // Match SocraticPlanPanel: fall back to first step so the sim never has null while the list has steps.
  const socraticPlan = designDoc?.socratic_plan ?? []
  const activeStep = socraticPlan.find(step => step.id === activeStepId) ?? socraticPlan[0] ?? null

  // Auto-speak the step's question when entering a new step (initial load,
  // dropdown switch). Skipped when the tutor itself triggered the advance —
  // its Call 2 speech already covers the transition. Guarded so the same step
  // is never read twice (re-renders, strict-mode double-invoke).
  const autoReadStepId = activeStep?.id ?? null
  const autoReadQuestion = activeStep?.question ?? null
  useEffect(() => {
    if (!autoReadStepId || !autoReadQuestion) return
    if (autoReadStepIdRef.current === autoReadStepId) return
    if (skipNextAutoReadRef.current) {
      skipNextAutoReadRef.current = false
      autoReadStepIdRef.current = autoReadStepId
      return
    }
    if (tutorTurnInFlightRef.current) return

    autoReadStepIdRef.current = autoReadStepId
    let cancelled = false
    console.log('[tutor] auto-reading step question:', autoReadStepId)
    void (async () => {
      setTutorState(prev => (prev === 'idle' ? 'tutor speaking' : prev))
      const result = await speakTutorText(autoReadQuestion)
      if (cancelled) return
      if (result.blocked) {
        pendingAutoReadRef.current = { stepId: autoReadStepId, text: autoReadQuestion }
        console.log('[tutor] auto-read queued until first user gesture')
      } else if (result.ok) {
        stepQuestionReadAloudRef.current = autoReadStepId
      }
      setTutorState(prev => (prev === 'tutor speaking' ? 'idle' : prev))
    })()
    return () => { cancelled = true }
  }, [autoReadStepId, autoReadQuestion, speakTutorText])

  // First user gesture unlocks queued auto-read audio (browser autoplay policy).
  // If the gesture lands on the tutor strip (mic/send/input), the user is about
  // to engage the tutor themselves — clear the queue without playing so we
  // never stomp on their action.
  useEffect(() => {
    const flush = (target: EventTarget | null) => {
      const queued = pendingAutoReadRef.current
      if (!queued) return
      if (tutorTurnInFlightRef.current) return
      if (tutorStateRef.current !== 'idle') return
      if (target instanceof Element && target.closest('[data-tutor-strip="true"]')) return
      pendingAutoReadRef.current = null
      void (async () => {
        setTutorState(prev => (prev === 'idle' ? 'tutor speaking' : prev))
        const r = await speakTutorText(queued.text)
        if (r.ok) {
          stepQuestionReadAloudRef.current = queued.stepId
        }
        setTutorState(prev => (prev === 'tutor speaking' ? 'idle' : prev))
      })()
    }
    const onGesture = (e: Event) => flush(e.target)
    window.addEventListener('pointerdown', onGesture)
    window.addEventListener('keydown', onGesture)
    return () => {
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
    }
  }, [speakTutorText])

  return (
    <div className="relative flex h-screen flex-col overflow-hidden text-[color:var(--ink)]">
      {sandboxLoading ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-white/90 backdrop-blur-sm">
          <div className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--accent)]" />
          <p className="text-sm text-[color:var(--ink2)]">Starting simulation runtime…</p>
          <p className="max-w-sm text-center text-xs text-[color:var(--ink3)]">Waiting for manifest from iframe.</p>
        </div>
      ) : null}

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
          activeStepId={activeStepId}
          episodicFromDesign={designDoc?.episodic !== false}
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

        {manifest && activeStep?.interaction?.kind !== 'prediction_sketch' ? (
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
        onMic={handleMic}
        tutorState={tutorState}
        simEventHint={simEventHint}
        showSimHint
      />
    </div>
  )
}
