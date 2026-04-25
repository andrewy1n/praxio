'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { GenerateErrorResponse, GenerateResponse } from '@/lib/types'
import type { GenerationAttemptPhase } from '@/lib/generationPipeline'

type Step = 'pending' | 'active' | 'done' | 'failed'

const STEPS = [
  { id: 'p1', label: 'Pass 1 — concept -> design doc' },
  { id: 'dc', label: 'Design doc consistency checks' },
  { id: 'p2', label: 'Pass 2 — generate + static validate sim code' },
  { id: 'bv', label: 'Behavioral verification checks' },
  { id: 'sb', label: 'Sandbox — iframe runtime loading' },
]

function buildStepStates(activeIndex: number): Step[] {
  return STEPS.map((_, i) => (i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending'))
}

function buildFailedStepStates(failedIndex: number): Step[] {
  return STEPS.map((_, i) => (i < failedIndex ? 'done' : i === failedIndex ? 'failed' : 'pending'))
}

function phaseToStepIndex(phase: GenerateErrorResponse['phase'] | undefined): number {
  switch (phase) {
    case 'pass1': return 0
    case 'designDocConsistency': return 1
    case 'pass2':
    case 'validation': return 2
    case 'verification': return 3
    case 'fallback':
    case 'template': return 4
    default: return 0
  }
}

function attemptPhaseToStepIndex(phase: GenerationAttemptPhase): number {
  switch (phase) {
    case 'pass1': return 0
    case 'designDocConsistency': return 1
    case 'pass2':
    case 'staticValidation': return 2
    case 'behavioralVerification': return 3
    case 'fallback': return 4
    default: return 0
  }
}

type GenerateStreamEvent =
  | { type: 'started' }
  | { type: 'attempt'; attempt: { phase: GenerationAttemptPhase; ok: boolean } }
  | { type: 'result'; result: GenerateResponse }
  | { type: 'error'; status: number; error: GenerateErrorResponse }

function StepRow({ label, state }: { label: string; state: Step }) {
  return (
    <div className={`flex gap-3 items-start transition-opacity duration-400 ${state === 'pending' ? 'opacity-30' : 'opacity-100'}`}>
      <div className={`w-5 h-5 rounded-full shrink-0 mt-0.5 flex items-center justify-center border transition-all duration-400
        ${state === 'done'
          ? 'bg-orange-400 border-orange-400'
          : state === 'active'
            ? 'border-orange-400 bg-transparent'
            : state === 'failed'
              ? 'bg-red-500 border-red-500'
              : 'border-zinc-700 bg-zinc-800'}`}>
        {state === 'done' && (
          <svg width="10" height="10" viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3" fill="none" stroke="#09090b" strokeWidth="2" strokeLinecap="round"/></svg>
        )}
        {state === 'active' && (
          <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
        )}
        {state === 'failed' && (
          <svg width="10" height="10" viewBox="0 0 12 12"><line x1="3" y1="3" x2="9" y2="9" stroke="#09090b" strokeWidth="2" strokeLinecap="round"/><line x1="9" y1="3" x2="3" y2="9" stroke="#09090b" strokeWidth="2" strokeLinecap="round"/></svg>
        )}
      </div>
      <span className={`text-sm font-medium transition-colors duration-300
        ${state === 'done'
          ? 'text-zinc-100'
          : state === 'active'
            ? 'text-orange-400'
            : state === 'failed'
              ? 'text-red-400'
              : 'text-zinc-500'}`}>
        {label}
      </span>
    </div>
  )
}

function GenerationLoadingScreen({ concept }: { concept: string }) {
  const [steps, setSteps] = useState<Step[]>(buildStepStates(0))

  useEffect(() => {
    const timers = [
      setTimeout(() => setSteps(buildStepStates(1)), 2500),
      setTimeout(() => setSteps(buildStepStates(2)), 5200),
      setTimeout(() => setSteps(buildStepStates(3)), 8500),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  const allDone = steps.every(s => s === 'done')

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
          : 'generating simulation via Gemini 3 Flash (validation/fallback may add retries)...'}
      </p>
    </div>
  )
}

export default function LandingPage() {
  const router = useRouter()
  const [concept, setConcept] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stepsRef = useRef<React.Dispatch<React.SetStateAction<Step[]>> | null>(null)
  const highestStepRef = useRef(0)

  const handleGenerate = async () => {
    if (!concept.trim()) return
    setLoading(true)
    setError(null)
    highestStepRef.current = 0
    try {
      const res = await fetch('/api/generate?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept }),
      })

      if (!res.body) {
        throw new Error('Server returned no stream body')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalResult: GenerateResponse | null = null
      let streamError: Error | null = null

      const applyAttemptProgress = (phase: GenerationAttemptPhase, ok: boolean) => {
        const idx = attemptPhaseToStepIndex(phase)
        if (ok) {
          highestStepRef.current = Math.max(highestStepRef.current, idx + 1)
          if (stepsRef.current) stepsRef.current(buildStepStates(highestStepRef.current))
          return
        }
        if (stepsRef.current) {
          stepsRef.current(prev => {
            if (phase === 'pass1') return buildStepStates(0)
            return prev
          })
        }
      }

      const handleErrorBody = (errBody: Partial<GenerateErrorResponse>) => {
        const phase = errBody.phase
        const failedIndex = phaseToStepIndex(phase)
        if (stepsRef.current) stepsRef.current(buildFailedStepStates(failedIndex))

        let details = errBody.error ?? 'Failed to generate simulation'
        if (phase === 'designDocConsistency' && errBody.consistencyErrors?.length) {
          const lines = errBody.consistencyErrors
            .slice(0, 3)
            .map(e => `${e.path}: ${e.message}`)
          details = `${details} [${phase}] ${lines.join(' | ')}`
        } else if (phase) {
          details = `${details} [${phase}]`
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
          if (event.type === 'attempt') {
            applyAttemptProgress(event.attempt.phase, event.attempt.ok)
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

      if (stepsRef.current) stepsRef.current(buildStepStates(4))
      await new Promise(r => setTimeout(r, 300))
      if (stepsRef.current) stepsRef.current(buildStepStates(STEPS.length))
      await new Promise(r => setTimeout(r, 250))

      const workspaceId = crypto.randomUUID()
      sessionStorage.setItem(`workspace:${workspaceId}`, JSON.stringify(finalResult))
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

// Controlled variant so the workspace page can drive step state via ref
function GenerationLoadingScreenControlled({
  concept,
  stepsRef,
}: {
  concept: string
  stepsRef: React.MutableRefObject<React.Dispatch<React.SetStateAction<Step[]>> | null>
}) {
  const [steps, setSteps] = useState<Step[]>(buildStepStates(0))

  useEffect(() => {
    stepsRef.current = setSteps
    return () => {
      if (stepsRef.current === setSteps) stepsRef.current = null
    }
  }, [stepsRef])

  const allDone = steps.every(s => s === 'done')

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
          : 'generating simulation via Gemini 3 Flash (validation/fallback may add retries)...'}
      </p>
    </div>
  )
}
