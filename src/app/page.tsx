'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type {
  GenerateErrorResponse,
  GenerateResponse,
  GenerateStreamEvent,
  GenerateProgressStepId,
  WorkspaceListItem,
} from '@/lib/types'
import { pickSupportedMimeType } from '@/lib/micRecording'
import PraxioLogo from '@/components/PraxioLogo'

type Step = 'pending' | 'active' | 'done' | 'failed'

const TRACE_MAX = 5

type TraceEntry = { ts: number; label: string; rawType: string }

type LoadError = {
  message: string
  phaseLabel: string
  hint: string
}

type LandingMicState = 'idle' | 'listening' | 'processing'
type RecentWorkspacesState = 'idle' | 'loading' | 'ready' | 'error'

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function formatRelativeTime(input: string): string {
  const t = new Date(input).getTime()
  if (!Number.isFinite(t)) return 'just now'
  const diffMs = Date.now() - t
  const diffMin = Math.max(0, Math.floor(diffMs / 60000))
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(t).toLocaleDateString()
}

function statusLabel(status: WorkspaceListItem['status']): string {
  return status === 'completed' ? 'completed' : 'in progress'
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function errorPhaseToLabel(phase: GenerateErrorResponse['phase'] | undefined): string {
  const map: Record<GenerateErrorResponse['phase'], string> = {
    curriculumAgent: 'Curriculum',
    requestValidation: 'Request',
    verificationSpecAgent: 'Verification spec',
    designDocConsistency: 'Plan consistency',
    simBuilderAgent: 'Sim builder',
    validation: 'Code validation',
    fallback: 'Fallback',
    template: 'Template',
    behavioralVerification: 'Behavioral verification',
  }
  if (!phase) return 'Unknown'
  return map[phase] ?? phase
}

function humanizeProgressStarted(ev: Extract<GenerateStreamEvent, { type: 'progress_step_started' }>): string {
  const a = ev.attempt != null ? ` (attempt ${ev.attempt})` : ''
  switch (ev.step) {
    case 'curriculum':
      return `Drafting teaching sequence${a}…`
    case 'verificationSpec':
      return `Defining what to check${a}…`
    case 'designDocConsistency':
      return 'Checking concept plan consistency…'
    case 'simBuilder': {
      if (ev.subStep === 'static') return `Running static checks${a}…`
      return `Generating simulation code${a}…`
    }
    case 'behavioralVerify':
      return 'Running behavior probes…'
    case 'fallback':
      return 'Using template fallback…'
    default:
      return 'Working…'
  }
}

function humanizeProgressCompleted(ev: Extract<GenerateStreamEvent, { type: 'progress_step_completed' }>): string {
  if (!ev.ok) return 'Step finished with issues…'
  if (ev.subStep === 'static' && ev.ok) return 'Static checks passed'
  if (ev.subStep === 'model' && ev.ok) return 'Code generated, validating…'
  if (ev.step === 'behavioralVerify' && ev.ok) return 'Behavior checks passed'
  if (ev.step === 'curriculum' && ev.ok) return 'Curriculum pass complete'
  if (ev.step === 'verificationSpec' && ev.ok) return 'Specification ready'
  if (ev.step === 'designDocConsistency' && ev.ok) return 'Plan is consistent'
  if (ev.step === 'simBuilder' && ev.ok) return 'Sim build step complete'
  if (ev.detail) return String(ev.detail)
  return 'Done'
}

function hintForPhase(phase: GenerateErrorResponse['phase'] | undefined): string {
  if (phase === 'designDocConsistency') return 'Try rephrasing the concept or use an example to narrow the idea.'
  if (phase === 'requestValidation' || phase === 'curriculumAgent') return 'Check your input and try again, or use a demo workspace below.'
  if (phase === 'behavioralVerification' || phase === 'validation' || phase === 'simBuilderAgent') return 'Sometimes a shorter or clearer concept helps. You can also try a demo from the home screen.'
  return 'Try again, or open a demo workspace while we work on reliability.'
}

function lineForAttempt(attempt: Record<string, unknown>): string {
  const phase = String(attempt.phase ?? '?')
  const n = attempt.attempt != null ? ` #${String(attempt.attempt)}` : ''
  const ok = attempt.ok === true ? 'ok' : attempt.ok === false ? 'fail' : '—'
  return `${phase}${n} → ${ok}`
}

function getSessionId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('sessionId')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('sessionId', id)
  }
  return id
}

const STEPS: Array<{ id: string; label: string; title: string }> = [
  { id: 'ca', label: 'Curriculum Agent', title: 'Decides the teaching path and socratic plan for your concept' },
  { id: 'vs', label: 'Verification Spec Agent', title: 'Defines what the simulation should demonstrate and how it will be checked' },
  { id: 'sb', label: 'Sim Builder Agent', title: 'Generates runnable sim code and passes static checks' },
  { id: 'bv', label: 'Behavioral Verify', title: 'Runs probes to see if the sim behaves as intended' },
  { id: 'sbx', label: 'Sandbox load', title: 'Loads the sim in the secure iframe runtime' },
]

function buildStepStatesFromActive(activeIndex: number): Step[] {
  return STEPS.map((_, i) => {
    if (i < activeIndex) return 'done'
    if (i === activeIndex) return 'active'
    return 'pending'
  })
}

function buildFailedStepStates(failedIndex: number): Step[] {
  return STEPS.map((_, i) => (i < failedIndex ? 'done' : i === failedIndex ? 'failed' : 'pending'))
}

function progressStepToUiIndex(step: GenerateProgressStepId): number {
  switch (step) {
    case 'curriculum':
      return 0
    case 'verificationSpec':
    case 'designDocConsistency':
      return 1
    case 'simBuilder':
    case 'fallback':
      return 2
    case 'behavioralVerify':
      return 3
    default:
      return 0
  }
}

function errorPhaseToStepIndex(phase: GenerateErrorResponse['phase'] | undefined): number {
  switch (phase) {
    case 'curriculumAgent':
    case 'requestValidation':
      return 0
    case 'verificationSpecAgent':
    case 'designDocConsistency':
      return 1
    case 'simBuilderAgent':
    case 'validation':
    case 'fallback':
    case 'template':
      return 2
    case 'behavioralVerification':
      return 3
    default:
      return 0
  }
}

function StepRow({ label, state, title }: { label: string; state: Step; title?: string }) {
  return (
    <div title={title} className={`flex gap-3 items-start transition-opacity duration-400 ${state === 'pending' ? 'opacity-40' : 'opacity-100'}`}>
      <div
        className={`w-[18px] h-[18px] rounded-full shrink-0 mt-[2px] flex items-center justify-center border transition-all duration-400
        ${
        state === 'done'
          ? 'bg-[color:var(--accent)] border-[color:var(--accent)]'
          : state === 'active'
            ? 'border-[color:var(--accent)] bg-transparent'
            : state === 'failed'
              ? 'bg-red-500 border-red-500'
              : 'border-[color:var(--border)] bg-[color:var(--surface2)]'}`}
      >
        {state === 'done' && (
          <svg width="10" height="10" viewBox="0 0 12 12">
            <polyline
              points="2,6 5,9 10,3"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
        {state === 'active' && (
          <div className="w-[6px] h-[6px] rounded-full bg-[color:var(--accent)] animate-pulse" />
        )}
        {state === 'failed' && (
          <svg width="10" height="10" viewBox="0 0 12 12">
            <line x1="3" y1="3" x2="9" y2="9" stroke="white" strokeWidth="2" strokeLinecap="round" />
            <line x1="9" y1="3" x2="3" y2="9" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <span
        className={`text-[13px] font-medium transition-colors duration-300
        ${
        state === 'done'
          ? 'text-[color:var(--ink)]'
          : state === 'active'
            ? 'text-[color:var(--accent)]'
            : state === 'failed'
              ? 'text-red-600'
              : 'text-[color:var(--ink3)]'}`}
      >
        {label}
      </span>
    </div>
  )
}

export default function LandingPage() {
  const router = useRouter()
  const [concept, setConcept] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [genSteps, setGenSteps] = useState<Step[]>(buildStepStatesFromActive(0))
  const [activeStepDetail, setActiveStepDetail] = useState<string | null>(null)
  const [stepAttempts, setStepAttempts] = useState<Record<number, number>>({})
  const [stepStartedAt, setStepStartedAt] = useState<Record<number, number>>({})
  const [generationStartedAt, setGenerationStartedAt] = useState(() => Date.now())
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [recentTrace, setRecentTrace] = useState<TraceEntry[]>([])
  const [retryingIndex, setRetryingIndex] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<LoadError | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [micState, setMicState] = useState<LandingMicState>('idle')
  const [recentState, setRecentState] = useState<RecentWorkspacesState>('idle')
  const [recentItems, setRecentItems] = useState<WorkspaceListItem[]>([])
  const [recentError, setRecentError] = useState<string | null>(null)
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const micCancelledRef = useRef(false)
  // Default false so server HTML matches the client's first paint; real value
  // is set after mount (avoid hydration mismatch from `typeof window`).
  const [micSupported, setMicSupported] = useState(false)

  useEffect(() => {
    setMicSupported(
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof window.MediaRecorder !== 'undefined',
    )
  }, [])

  const refreshRecentWorkspaces = useCallback(async () => {
    const sessionId = getSessionId()
    if (!sessionId) return

    setRecentState('loading')
    setRecentError(null)
    try {
      const res = await fetch(`/api/workspaces?sessionId=${encodeURIComponent(sessionId)}&limit=20`)
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(body || `Request failed (${res.status})`)
      }
      const payload = await res.json() as { items?: WorkspaceListItem[] }
      setRecentItems(Array.isArray(payload.items) ? payload.items : [])
      setRecentState('ready')
    } catch (err) {
      setRecentState('error')
      setRecentError(err instanceof Error ? err.message : 'Failed to load recent workspaces')
    }
  }, [])

  useEffect(() => {
    void refreshRecentWorkspaces()
  }, [refreshRecentWorkspaces])

  useEffect(() => {
    if (!loading) return
    if (loadError) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [loading, loadError])

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

  const transcribeAndAppend = useCallback(async (blob: Blob) => {
    if (blob.size === 0) {
      console.warn('[stt] empty audio blob; skipping transcription')
      setMicState('idle')
      return
    }

    setMicState('processing')

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
        setMicState('idle')
        return
      }

      const data = await res.json() as { text?: string; rawText?: string; languageCode?: string | null }
      const transcript = typeof data.text === 'string' ? data.text.trim() : ''
      if (!transcript) {
        console.warn('[stt] empty transcript from ElevenLabs', {
          rawText: data.rawText ?? null,
          languageCode: data.languageCode ?? null,
        })
        setMicState('idle')
        return
      }

      setConcept(prev => (prev ? `${prev} ${transcript}` : transcript))
    } catch (err) {
      console.warn('[stt] transcription error', err)
    } finally {
      setMicState('idle')
    }
  }, [])

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
        setMicState('idle')
        return
      }

      const blob = new Blob(chunks, { type })
      void transcribeAndAppend(blob)
    }

    try {
      recorder.start()
      setMicState('listening')
    } catch (err) {
      console.warn('[stt] failed to start MediaRecorder', err)
      releaseMicStream()
      setMicState('idle')
    }
  }, [releaseMicStream, transcribeAndAppend])

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
    if (!micSupported) return
    if (micState === 'listening') {
      stopMicCapture()
      return
    }
    if (micState !== 'idle') return
    void startMicCapture()
  }, [micState, micSupported, startMicCapture, stopMicCapture])

  useEffect(() => {
    return () => {
      stopMicCapture({ cancel: true })
    }
  }, [stopMicCapture])

  const handleGenerate = async () => {
    if (!concept.trim()) return
    setLoadError(null)
    setError(null)
    setLoading(true)
    const started = Date.now()
    setGenerationStartedAt(started)
    setNow(started)
    setGenSteps(buildStepStatesFromActive(0))
    setActiveStepDetail('Connecting to generator…')
    setStepAttempts({})
    setStepStartedAt({ 0: started })
    setCurrentStepIndex(0)
    setRecentTrace([])
    setRetryingIndex(null)

    let terminalError: LoadError | null = null
    const pushTrace = (rawType: string, label: string) => {
      setRecentTrace(prev => [...prev, { ts: Date.now(), label, rawType }].slice(-TRACE_MAX))
    }

    const handleErrorBody = (errBody: GenerateErrorResponse) => {
      const failedIndex = errorPhaseToStepIndex(errBody.phase)
      setGenSteps(buildFailedStepStates(failedIndex))
      const phaseLabel = errorPhaseToLabel(errBody.phase)
      let message = errBody.error ?? 'Failed to generate simulation'
      if (errBody.phase === 'designDocConsistency' && errBody.consistencyErrors?.length) {
        const lines = errBody.consistencyErrors
          .slice(0, 3)
          .map(e => `${e.path}: ${e.message}`)
        message = `${message} — ${lines.join(' | ')}`
      } else if (errBody.validationErrors?.length) {
        message = `${message} — ${errBody.validationErrors.slice(0, 2).join(' | ')}`
      }
      const hint = hintForPhase(errBody.phase)
      terminalError = { message, phaseLabel, hint }
    }

    const applyFromProgress = (ev: GenerateStreamEvent) => {
      if (ev.type === 'progress_step_started') {
        const u = progressStepToUiIndex(ev.step)
        setCurrentStepIndex(u)
        setStepStartedAt(prev => ({ ...prev, [u]: Date.now() }))
        if (ev.attempt != null) {
          setStepAttempts(prev => ({ ...prev, [u]: ev.attempt! }))
        }
        setActiveStepDetail(humanizeProgressStarted(ev))
        setRetryingIndex(null)
        setGenSteps(buildStepStatesFromActive(u))
        return
      }
      if (ev.type === 'progress_step_failed') {
        const u = progressStepToUiIndex(ev.step)
        const shortErr = (ev.error?.length > 100 ? `${ev.error.slice(0, 100)}…` : ev.error) || 'error'
        pushTrace('progress_step_failed', `${ev.step}: ${shortErr}${ev.willRetry ? ' (will retry)' : ''}`)
        if (ev.willRetry) {
          setRetryingIndex(u)
          setActiveStepDetail('This stage failed, retrying automatically…')
        }
        return
      }
      if (ev.type !== 'progress_step_completed') return
      if (!ev.ok) return
      if (ev.step === 'simBuilder' && ev.subStep === 'model') {
        setGenSteps(buildStepStatesFromActive(2))
        setActiveStepDetail(humanizeProgressCompleted(ev))
        return
      }
      if (ev.step === 'simBuilder' && ev.subStep === 'static') {
        if (ev.ok) {
          setGenSteps(buildStepStatesFromActive(3))
        }
        setActiveStepDetail(humanizeProgressCompleted(ev))
        return
      }
      const u = progressStepToUiIndex(ev.step)
      const nextA = u + 1
      if (nextA < STEPS.length) {
        setGenSteps(buildStepStatesFromActive(nextA))
        setCurrentStepIndex(nextA)
        setStepStartedAt(prev => ({ ...prev, [nextA]: Date.now() }))
      } else {
        setGenSteps(buildStepStatesFromActive(STEPS.length - 1))
      }
      setActiveStepDetail(humanizeProgressCompleted(ev))
    }

    try {
      const res = await fetch('/api/generate?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept, sessionId: getSessionId() }),
      })

      if (!res.ok) {
        let message = `Request failed (${res.status})`
        try {
          const j = JSON.parse(await res.text()) as { error?: string }
          if (j.error) message = j.error
        } catch {
          /* use default */
        }
        setLoadError({
          message,
          phaseLabel: 'Request',
          hint: hintForPhase('requestValidation'),
        })
        return
      }

      if (!res.body) {
        setLoadError({
          message: 'Server returned no stream body',
          phaseLabel: 'Stream',
          hint: 'Check your network and try again.',
        })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalResult: GenerateResponse | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as GenerateStreamEvent
          if (event.type === 'started') {
            pushTrace('started', 'Stream started')
            setActiveStepDetail('Generator ready…')
          } else if (event.type === 'progress_step_started' || event.type === 'progress_step_completed' || event.type === 'progress_step_failed') {
            applyFromProgress(event)
          } else if (event.type === 'attempt' && event.attempt && typeof event.attempt === 'object') {
            pushTrace('attempt', lineForAttempt(event.attempt as Record<string, unknown>))
          } else if (event.type === 'result') {
            finalResult = event.result
          } else if (event.type === 'error') {
            handleErrorBody(event.error)
          }
        }
      }

      if (buffer.trim()) {
        const event = JSON.parse(buffer) as GenerateStreamEvent
        if (event.type === 'result') finalResult = event.result
        if (event.type === 'error') handleErrorBody(event.error)
        if (event.type === 'started') {
          pushTrace('started', 'Stream started')
        }
        if (event.type === 'progress_step_started' || event.type === 'progress_step_completed' || event.type === 'progress_step_failed') {
          applyFromProgress(event)
        }
        if (event.type === 'attempt' && event.attempt && typeof event.attempt === 'object') {
          pushTrace('attempt', lineForAttempt(event.attempt as Record<string, unknown>))
        }
      }

      if (terminalError) {
        setLoadError(terminalError)
        return
      }
      if (!finalResult?.designDoc || !finalResult?.simCode) {
        setLoadError({
          message: 'Server returned incomplete generation payload',
          phaseLabel: 'Result',
          hint: 'Try again in a few seconds.',
        })
        return
      }

      setActiveStepDetail('Launching runtime iframe…')
      const preSandbox = buildStepStatesFromActive(4)
      for (let i = 0; i < 4; i++) preSandbox[i] = 'done'
      preSandbox[4] = 'active'
      setGenSteps(preSandbox)

      const workspaceId = finalResult.workspaceId ?? crypto.randomUUID()
      if (!finalResult.workspaceId) {
        sessionStorage.setItem(`workspace:${workspaceId}`, JSON.stringify(finalResult))
      }
      router.push(`/workspace/${workspaceId}`)
    } catch (err) {
      setLoadError({
        message: err instanceof Error ? err.message : 'Unexpected error',
        phaseLabel: 'Error',
        hint: 'Try again or use a demo workspace below.',
      })
    }
  }

  const handleBackFromGeneration = () => {
    setLoading(false)
    setLoadError(null)
    void refreshRecentWorkspaces()
  }

  const handleDeleteWorkspace = useCallback(async (workspaceId: string, conceptLabel: string) => {
    if (deletingWorkspaceId) return
    const confirmDelete = window.confirm(`Delete workspace "${conceptLabel}"? This cannot be undone.`)
    if (!confirmDelete) return

    const sessionId = getSessionId()
    if (!sessionId) return

    setDeletingWorkspaceId(workspaceId)
    setRecentError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceId)}?sessionId=${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(body || `Delete failed (${res.status})`)
      }
      setRecentItems(prev => prev.filter(item => item.workspaceId !== workspaceId))
      setRecentState('ready')
    } catch (err) {
      setRecentError(err instanceof Error ? err.message : 'Failed to delete workspace')
    } finally {
      setDeletingWorkspaceId(null)
    }
  }, [deletingWorkspaceId])

  if (loading) {
    return (
      <GenerationLoadingScreen
        concept={concept}
        steps={genSteps}
        activeStepDetail={activeStepDetail}
        retryingStepIndex={retryingIndex}
        stepAttempts={stepAttempts}
        stepStartedAt={stepStartedAt}
        currentStepIndex={currentStepIndex}
        generationStartedAt={generationStartedAt}
        now={now}
        recentTrace={recentTrace}
        loadError={loadError}
        onBackFromGeneration={handleBackFromGeneration}
        onRetryGeneration={() => void handleGenerate()}
      />
    )
  }

  const today: WorkspaceListItem[] = []
  const earlier: WorkspaceListItem[] = []
  const nowDate = new Date()
  for (const item of recentItems) {
    const ts = new Date(item.lastActiveAt || item.createdAt)
    if (isSameLocalDay(ts, nowDate)) today.push(item)
    else earlier.push(item)
  }

  return (
    <div className="flex flex-col items-center min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)] px-6 pt-[20vh]">
      <div className="absolute top-6 left-6 flex items-center gap-2">
        <PraxioLogo />
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-[color:var(--ink)]">Praxio</span>
      </div>

      <div className="absolute top-6 right-6">
        <div
          className="flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded-full bg-gradient-to-br from-[oklch(75%_0.12_280)] to-[oklch(65%_0.14_240)] text-[11px] font-semibold text-white shadow-[var(--shadow-sm)]"
          title="Demo user"
        >
          U
        </div>
      </div>
      
      <div className="w-full max-w-[var(--measure-lg)] mx-auto flex flex-col items-center">
        <h1 className="text-[28px] font-medium tracking-tight mb-10 text-center leading-tight">
          Master any concept through{' '}
          <br />
          <span className="praxio-interactive-sim-hover">
            interactive simulation
          </span>
        </h1>
        <div className="flex gap-3 w-full mb-12">
          <input
            type="text"
            value={concept}
            onChange={e => setConcept(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleGenerate()}
            placeholder="e.g. why 45° maximizes projectile range"
            className="flex-1 bg-white border border-[color:var(--border)] rounded-[var(--r)] px-4 py-3 text-[14px] outline-none placeholder-[color:var(--ink4)] shadow-[var(--shadow-sm)] focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent-light)] transition-all"
          />
          <button
            type="button"
            onClick={handleMic}
            disabled={!micSupported || micState === 'processing'}
            className={`flex items-center justify-center w-[46px] h-[46px] shrink-0 rounded-[var(--r)] border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              micState === 'listening'
                ? 'bg-red-500/10 border-red-500 text-red-500 animate-pulse'
                : micState === 'processing'
                  ? 'bg-[oklch(68%_0.14_82_/_0.12)] border-[oklch(68%_0.14_82)] text-[oklch(55%_0.12_82)] animate-pulse'
                  : 'bg-white border-[color:var(--border)] text-[color:var(--ink2)] hover:border-[color:var(--border-strong)] shadow-[var(--shadow-sm)]'
            }`}
            title={
              !micSupported
                ? 'Speak (STT) unavailable'
                : micState === 'listening'
                  ? 'Stop & transcribe'
                  : micState === 'processing'
                    ? 'Transcribing…'
                    : 'Speak concept'
            }
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="22"></line>
            </svg>
          </button>
          <button
            onClick={handleGenerate}
            disabled={!concept.trim()}
            className="px-5 py-3 bg-[color:var(--accent)] text-white rounded-[var(--r)] text-[13px] font-medium disabled:opacity-40 shadow-[var(--shadow-sm)] hover:bg-[color:var(--accent-mid)] transition-colors"
          >
            Generate
          </button>
        </div>
        {error && <p className="mb-8 text-[13px] text-red-500">{error}</p>}
        
        <div className="w-full border-t border-[color:var(--border)] pt-8">
          <h2 className="text-[12px] uppercase tracking-[0.06em] text-[color:var(--ink3)] font-semibold mb-4">Recent workspaces</h2>
          <div className="mb-8 rounded-[var(--r)] border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-sm)]">
            {recentState === 'loading' || recentState === 'idle' ? (
              <p className="px-4 py-4 text-[12px] text-[color:var(--ink3)]">Loading recent workspaces…</p>
            ) : null}

            {recentState === 'error' ? (
              <div className="px-4 py-4">
                <p className="text-[12px] text-red-600">Could not load recent workspaces.</p>
                {recentError ? (
                  <p className="mt-1 line-clamp-2 text-[11px] text-red-500/90">{recentError}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void refreshRecentWorkspaces()}
                  className="mt-3 rounded-[var(--r)] border border-[color:var(--border)] bg-white px-3 py-1.5 text-[12px] text-[color:var(--ink2)] hover:border-[color:var(--border-strong)]"
                >
                  Retry
                </button>
              </div>
            ) : null}

            {recentState === 'ready' && recentItems.length === 0 ? (
              <p className="px-4 py-4 text-[12px] text-[color:var(--ink3)]">No recent workspaces yet</p>
            ) : null}

            {recentState === 'ready' && recentItems.length > 0 ? (
              <div className="divide-y divide-[color:var(--border)]">
                {today.length > 0 ? (
                  <section>
                    <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ink3)]">Today</p>
                    <div className="grid grid-cols-1 gap-3 p-4 pt-2 sm:grid-cols-2">
                      {today.map(item => (
                        <div
                          key={item.workspaceId}
                          className="flex flex-col gap-3 rounded-[var(--r)] border border-[color:var(--border)] bg-white p-4 shadow-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-[color:var(--ink)]">{item.concept}</p>
                            <p className="mt-0.5 text-[11px] text-[color:var(--ink3)]">{formatRelativeTime(item.lastActiveAt || item.createdAt)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              item.status === 'completed'
                                ? 'bg-[oklch(84%_0.05_150)] text-[oklch(38%_0.1_150)]'
                                : 'bg-[oklch(90%_0.03_255)] text-[oklch(44%_0.1_255)]'
                            }`}
                            >
                              {statusLabel(item.status)}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => router.push(`/workspace/${encodeURIComponent(item.workspaceId)}`)}
                              disabled={deletingWorkspaceId === item.workspaceId}
                              className="rounded-[var(--r)] border border-[color:var(--border)] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[color:var(--ink2)] hover:border-[color:var(--border-strong)]"
                            >
                              Resume
                            </button>
                            {item.status === 'completed' ? (
                              <button
                                type="button"
                                onClick={() => router.push(`/workspace/${encodeURIComponent(item.workspaceId)}?replay=1`)}
                                disabled={deletingWorkspaceId === item.workspaceId}
                                className="rounded-[var(--r)] border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 py-1.5 text-[11px] font-medium text-[color:var(--ink2)] hover:border-[color:var(--border-strong)]"
                              >
                                Replay last step
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void handleDeleteWorkspace(item.workspaceId, item.concept)}
                              disabled={deletingWorkspaceId === item.workspaceId}
                              className="rounded-[var(--r)] border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-700 hover:border-red-300 disabled:opacity-50"
                            >
                              {deletingWorkspaceId === item.workspaceId ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {earlier.length > 0 ? (
                  <section>
                    <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ink3)]">Earlier</p>
                    <div className="grid grid-cols-1 gap-3 p-4 pt-2 sm:grid-cols-2">
                      {earlier.map(item => (
                        <div
                          key={item.workspaceId}
                          className="flex flex-col gap-3 rounded-[var(--r)] border border-[color:var(--border)] bg-white p-4 shadow-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-[color:var(--ink)]">{item.concept}</p>
                            <p className="mt-0.5 text-[11px] text-[color:var(--ink3)]">{formatRelativeTime(item.lastActiveAt || item.createdAt)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              item.status === 'completed'
                                ? 'bg-[oklch(84%_0.05_150)] text-[oklch(38%_0.1_150)]'
                                : 'bg-[oklch(90%_0.03_255)] text-[oklch(44%_0.1_255)]'
                            }`}
                            >
                              {statusLabel(item.status)}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => router.push(`/workspace/${encodeURIComponent(item.workspaceId)}`)}
                              disabled={deletingWorkspaceId === item.workspaceId}
                              className="rounded-[var(--r)] border border-[color:var(--border)] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[color:var(--ink2)] hover:border-[color:var(--border-strong)]"
                            >
                              Resume
                            </button>
                            {item.status === 'completed' ? (
                              <button
                                type="button"
                                onClick={() => router.push(`/workspace/${encodeURIComponent(item.workspaceId)}?replay=1`)}
                                disabled={deletingWorkspaceId === item.workspaceId}
                                className="rounded-[var(--r)] border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 py-1.5 text-[11px] font-medium text-[color:var(--ink2)] hover:border-[color:var(--border-strong)]"
                              >
                                Replay last step
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void handleDeleteWorkspace(item.workspaceId, item.concept)}
                              disabled={deletingWorkspaceId === item.workspaceId}
                              className="rounded-[var(--r)] border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-700 hover:border-red-300 disabled:opacity-50"
                            >
                              {deletingWorkspaceId === item.workspaceId ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </div>

        </div>
      </div>
    </div>
  )
}

function GenerationLoadingScreen({
  concept,
  steps,
  activeStepDetail,
  retryingStepIndex,
  stepAttempts,
  stepStartedAt,
  currentStepIndex,
  generationStartedAt,
  now,
  recentTrace,
  loadError,
  onBackFromGeneration,
  onRetryGeneration,
}: {
  concept: string
  steps: Step[]
  activeStepDetail: string | null
  retryingStepIndex: number | null
  stepAttempts: Record<number, number>
  stepStartedAt: Record<number, number>
  currentStepIndex: number
  generationStartedAt: number
  now: number
  recentTrace: TraceEntry[]
  loadError: LoadError | null
  onBackFromGeneration: () => void
  onRetryGeneration: () => void
}) {
  const [showTrace, setShowTrace] = useState(false)
  const totalElapsed = now - generationStartedAt
  const currentSegStart
    = stepStartedAt[currentStepIndex] ?? generationStartedAt
  const stepElapsed = now - currentSegStart
  const allDone = steps.every(s => s === 'done')
  const onSandbox = steps[4] === 'active' || steps[4] === 'done'
  const retryA = retryingStepIndex != null && stepAttempts[retryingStepIndex] != null
    ? ` (attempt ${stepAttempts[retryingStepIndex]! + 1})`
    : ''

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[color:var(--bg)] px-6 text-[color:var(--ink)]">
        <div className="absolute top-6 left-6 flex items-center gap-2">
          <PraxioLogo />
          <span className="text-[14px] font-semibold tracking-[-0.01em] text-[color:var(--ink)]">Praxio</span>
        </div>
        <p className="mb-6 max-w-[var(--measure-lg)] text-center text-[15px] text-[color:var(--ink2)] leading-[1.45]">
          &ldquo;{concept}&rdquo;
        </p>
        <div
          className="w-full max-w-[min(100%,var(--measure-lg))] rounded-[var(--r)] border border-red-200 bg-red-50/80 p-5 shadow-[var(--shadow-sm)]"
        >
          <p className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-red-800">
            {loadError.phaseLabel} failed
          </p>
          <p className="mb-4 text-[13px] leading-snug text-red-900">{loadError.message}</p>
          <p className="mb-4 text-[12px] text-red-800/90">{loadError.hint}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRetryGeneration}
              className="rounded-[var(--r)] bg-[color:var(--accent)] px-4 py-2 text-[13px] font-medium text-white shadow-[var(--shadow-sm)] hover:opacity-90"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onBackFromGeneration}
              className="rounded-[var(--r)] border border-[color:var(--border)] bg-white px-4 py-2 text-[13px] font-medium text-[color:var(--ink)] hover:border-[color:var(--border-strong)]"
            >
              Back to input
            </button>
            <Link
              href="/workspace/demo"
              className="inline-flex items-center rounded-[var(--r)] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-[13px] font-medium text-[color:var(--ink2)] hover:border-[color:var(--border-strong)]"
            >
              Open demo
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[color:var(--bg)] px-6 text-[color:var(--ink)]">
      <div className="absolute top-6 left-6 flex items-center gap-2">
        <PraxioLogo />
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-[color:var(--ink)]">Praxio</span>
      </div>

      <div className="absolute top-6 right-6">
        <div
          className="flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded-full bg-gradient-to-br from-[oklch(75%_0.12_280)] to-[oklch(65%_0.14_240)] text-[11px] font-semibold text-white shadow-[var(--shadow-sm)]"
          title="Demo user"
        >
          U
        </div>
      </div>

      <p className="mb-6 max-w-[var(--measure-lg)] text-center text-[15px] text-[color:var(--ink2)] leading-[1.45]">
        &ldquo;{concept}&rdquo;
      </p>

      <div className="mb-3 flex w-full max-w-[360px] flex-wrap items-baseline justify-between gap-2 font-[family-name:var(--font-dm-mono)] text-[11px] text-[color:var(--ink3)]">
        <span>Total: {formatElapsed(totalElapsed)}</span>
        <span>
          Step: {formatElapsed(stepElapsed)} · {STEPS[currentStepIndex]?.label ?? '—'}
        </span>
      </div>

      <div className="w-full max-w-[360px] flex flex-col gap-[14px] p-6 bg-[color:var(--surface)] border border-[color:var(--border)] rounded-[var(--r)] shadow-[var(--shadow-sm)]">
        {STEPS.map((s, i) => (
          <StepRow key={s.id} label={s.label} state={steps[i] ?? 'pending'} title={s.title} />
        ))}
      </div>

      {activeStepDetail || retryingStepIndex != null ? (
        <div className="mt-4 w-full max-w-[360px] text-center text-[12px] leading-snug text-[color:var(--ink2)]">
          {activeStepDetail}
          {retryingStepIndex != null && (
            <span className="ml-1 inline-block rounded border border-amber-300/80 bg-amber-50/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900">
              Retrying{retryA}
            </span>
          )}
        </div>
      ) : null}

      <div className="mt-4 w-full max-w-[360px]">
        <button
          type="button"
          onClick={() => setShowTrace(v => !v)}
          className="w-full text-left text-[11px] font-medium text-[color:var(--accent)] underline decoration-[color:var(--accent)]/30 underline-offset-2 hover:decoration-[color:var(--accent)]"
        >
          {showTrace ? 'Hide live trace' : 'Show live trace'}
        </button>
        {showTrace && recentTrace.length > 0 ? (
          <ul className="mt-2 max-h-[120px] overflow-y-auto rounded border border-[color:var(--border)] bg-[color:var(--bg)] p-2 font-[family-name:var(--font-dm-mono)] text-[10px] leading-relaxed text-[color:var(--ink3)]">
            {recentTrace.map((e, i) => (
              <li key={`${e.ts}-${i}`} className="border-b border-[color:var(--border)]/50 py-0.5 last:border-0">
                {e.label}
              </li>
            ))}
          </ul>
        ) : null}
        {showTrace && recentTrace.length === 0 ? (
          <p className="mt-2 text-[10px] text-[color:var(--ink3)]">No events yet…</p>
        ) : null}
      </div>

      <p className="mt-6 text-[11px] font-mono uppercase tracking-[0.06em] text-[color:var(--ink3)]">
        {allDone
          ? 'Launching workspace…'
          : onSandbox
            ? 'Launching runtime iframe…'
            : 'Generation may take a minute; retries can extend a stage…'}
      </p>

      <button
        type="button"
        onClick={onBackFromGeneration}
        className="mt-4 text-[11px] text-[color:var(--ink3)] underline decoration-[color:var(--ink3)]/40 underline-offset-2 hover:text-[color:var(--ink2)]"
      >
        Cancel
      </button>
    </div>
  )
}
