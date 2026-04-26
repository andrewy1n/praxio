'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type {
  GenerateErrorResponse,
  GenerateResponse,
  GenerateStreamEvent,
  GenerateProgressStepId,
} from '@/lib/types'
import type { GenerationAttemptPhase } from '@/lib/generationPipeline'

type Step = 'pending' | 'active' | 'done' | 'failed'

function getSessionId(): string {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('sessionId')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('sessionId', id)
  }
  return id
}

const STEPS = [
  { id: 'ca', label: 'Curriculum Agent' },
  { id: 'vs', label: 'Verification Spec Agent' },
  { id: 'sb', label: 'Sim Builder Agent' },
  { id: 'bv', label: 'Behavioral Verify' },
  { id: 'sbx', label: 'Sandbox load' },
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

function attemptPhaseToStepIndex(phase: GenerationAttemptPhase): number {
  switch (phase) {
    case 'curriculumAgent':
      return 0
    case 'verificationSpecAgent':
    case 'designDocConsistency':
      return 1
    case 'simBuilderAgent':
    case 'staticValidation':
    case 'fallback':
    case 'template':
      return 2
    case 'behavioralVerification':
      return 3
    default:
      return 0
  }
}

function StepRow({ label, state }: { label: string; state: Step }) {
  return (
    <div className={`flex gap-3 items-start transition-opacity duration-400 ${state === 'pending' ? 'opacity-30' : 'opacity-100'}`}>
      <div
        className={`w-5 h-5 rounded-full shrink-0 mt-0.5 flex items-center justify-center border transition-all duration-400
        ${
        state === 'done'
          ? 'bg-orange-400 border-orange-400'
          : state === 'active'
            ? 'border-orange-400 bg-transparent'
            : state === 'failed'
              ? 'bg-red-500 border-red-500'
              : 'border-zinc-700 bg-zinc-800'}`}
      >
        {state === 'done' && (
          <svg width="10" height="10" viewBox="0 0 12 12">
            <polyline
              points="2,6 5,9 10,3"
              fill="none"
              stroke="#09090b"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        )}
        {state === 'active' && (
          <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
        )}
        {state === 'failed' && (
          <svg width="10" height="10" viewBox="0 0 12 12">
            <line x1="3" y1="3" x2="9" y2="9" stroke="#09090b" strokeWidth="2" strokeLinecap="round" />
            <line x1="9" y1="3" x2="3" y2="9" stroke="#09090b" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <span
        className={`text-sm font-medium transition-colors duration-300
        ${
        state === 'done'
          ? 'text-zinc-100'
          : state === 'active'
            ? 'text-orange-400'
            : state === 'failed'
              ? 'text-red-400'
              : 'text-zinc-500'}`}
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
  const stepsRef = useRef<React.Dispatch<React.SetStateAction<Step[]>> | null>(null)

  const handleGenerate = async () => {
    if (!concept.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/generate?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept, sessionId: getSessionId() }),
      })

      if (!res.body) {
        throw new Error('Server returned no stream body')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalResult: GenerateResponse | null = null
      let streamError: Error | null = null

      const applyFromProgress = (ev: GenerateStreamEvent) => {
        if (ev.type === 'progress_step_started') {
          const u = progressStepToUiIndex(ev.step)
          if (stepsRef.current) stepsRef.current(buildStepStatesFromActive(u))
        } else if (ev.type === 'progress_step_completed') {
          if (!ev.ok) return
          if (ev.step === 'simBuilder' && ev.subStep === 'model') {
            if (stepsRef.current) stepsRef.current(buildStepStatesFromActive(2))
            return
          }
          if (ev.step === 'simBuilder' && ev.subStep === 'static') {
            if (ev.ok) {
              if (stepsRef.current) stepsRef.current(buildStepStatesFromActive(3))
            }
            return
          }
          const u = progressStepToUiIndex(ev.step)
          const nextA = u + 1
          if (nextA < STEPS.length) {
            if (stepsRef.current) stepsRef.current(buildStepStatesFromActive(nextA))
          } else {
            if (stepsRef.current) stepsRef.current(buildStepStatesFromActive(STEPS.length - 1))
          }
        }
      }

      const applyAttempt = (phase: GenerationAttemptPhase, ok: boolean) => {
        const u = attemptPhaseToStepIndex(phase)
        if (ok) {
          if (stepsRef.current) {
            if (u + 1 < STEPS.length) stepsRef.current(buildStepStatesFromActive(u + 1))
            else stepsRef.current(buildStepStatesFromActive(u))
          }
        }
      }

      const handleErrorBody = (errBody: Partial<GenerateErrorResponse>) => {
        const failedIndex = errorPhaseToStepIndex(errBody.phase)
        if (stepsRef.current) stepsRef.current(buildFailedStepStates(failedIndex))

        let details = errBody.error ?? 'Failed to generate simulation'
        if (errBody.phase === 'designDocConsistency' && errBody.consistencyErrors?.length) {
          const lines = errBody.consistencyErrors
            .slice(0, 3)
            .map(e => `${e.path}: ${e.message}`)
          details = `${details} [${String(errBody.phase)}] ${lines.join(' | ')}`
        } else if (errBody.phase) {
          details = `${details} [${errBody.phase}]`
        }
        streamError = new Error(details)
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as GenerateStreamEvent
          if (event.type === 'progress_step_started' || event.type === 'progress_step_completed' || event.type === 'progress_step_failed') {
            applyFromProgress(event)
          } else if (event.type === 'attempt' && event.attempt && typeof event.attempt === 'object') {
            const a = event.attempt as { phase?: string; ok?: boolean }
            if (a.phase && typeof a.ok === 'boolean') {
              applyAttempt(a.phase as GenerationAttemptPhase, a.ok)
            }
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
      }

      if (streamError) throw streamError
      if (!finalResult?.designDoc || !finalResult?.simCode) {
        throw new Error('Server returned incomplete generation payload')
      }

      if (stepsRef.current) {
        const preSandbox = buildStepStatesFromActive(4)
        for (let i = 0; i < 4; i++) preSandbox[i] = 'done'
        preSandbox[4] = 'active'
        stepsRef.current(preSandbox)
      }

      const workspaceId = finalResult.workspaceId ?? crypto.randomUUID()
      if (!finalResult.workspaceId) {
        sessionStorage.setItem(`workspace:${workspaceId}`, JSON.stringify(finalResult))
      }
      router.push(`/workspace/${workspaceId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error')
      setLoading(false)
    }
  }

  if (loading) {
    return <GenerationLoadingScreenControlled concept={concept} stepsRef={stepsRef} />
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-zinc-100 px-6">
      <h1 className="text-2xl font-semibold mb-8">What are you stuck on?</h1>
      <div className="flex gap-3 w-full max-w-xl">
        <input
          type="text"
          value={concept}
          onChange={e => setConcept(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGenerate()}
          placeholder="e.g. why 45° maximizes projectile range"
          className="flex-1 bg-zinc-900 rounded px-4 py-3 text-sm outline-none placeholder-zinc-600"
        />
        <button
          onClick={handleGenerate}
          disabled={!concept.trim()}
          className="px-5 py-3 bg-zinc-100 text-zinc-900 rounded text-sm font-medium disabled:opacity-40"
        >
          Generate
        </button>
      </div>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </div>
  )
}

function GenerationLoadingScreenControlled({
  concept,
  stepsRef,
}: {
  concept: string
  stepsRef: React.MutableRefObject<React.Dispatch<React.SetStateAction<Step[]>> | null>
}) {
  const [steps, setSteps] = useState<Step[]>(buildStepStatesFromActive(0))

  useEffect(() => {
    stepsRef.current = setSteps
    return () => {
      if (stepsRef.current === setSteps) stepsRef.current = null
    }
  }, [stepsRef])

  const allDone = steps.every(s => s === 'done')
  const onSandbox = steps[4] === 'active' || steps[4] === 'done'

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-zinc-100 gap-0">
      <div className="text-sm font-semibold text-zinc-100 mb-2">Praxio</div>
      <p className="text-sm text-zinc-400 mb-9 max-w-md text-center leading-relaxed">
        &ldquo;{concept}&rdquo;
      </p>

      <div className="w-96 flex flex-col gap-3">
        {STEPS.map((s, i) => (
          <StepRow key={s.id} label={s.label} state={steps[i]} />
        ))}
      </div>

      <p className="mt-8 text-xs text-zinc-600 font-mono">
        {allDone
          ? 'launching workspace...'
          : onSandbox
            ? 'handoff to runtime…'
            : 'streaming generation steps (retries may extend a stage)…'}
      </p>
    </div>
  )
}
