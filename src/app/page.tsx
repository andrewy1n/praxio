'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
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

function Logo({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ borderRadius: '5px' }}
    >
      <rect width="22" height="22" fill="var(--accent)" />
      <circle cx="11" cy="11" r="4.5" fill="white" fillOpacity="0.9" />
      <rect x="7.5" y="7.5" width="7" height="7" rx="1.5" fill="white" fillOpacity="0.8" transform="rotate(45 11 11)" />
    </svg>
  )
}

function StepRow({ label, state }: { label: string; state: Step }) {
  return (
    <div className={`flex gap-3 items-start transition-opacity duration-400 ${state === 'pending' ? 'opacity-40' : 'opacity-100'}`}>
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
  const [isListening, setIsListening] = useState(false)
  const stepsRef = useRef<React.Dispatch<React.SetStateAction<Step[]>> | null>(null)
  const speechRecRef = useRef<any>(null)

  const handleMic = useCallback(() => {
    if (typeof window === 'undefined') return

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition
      || (window as any).webkitSpeechRecognition

    if (!SpeechRecognitionCtor) {
      console.warn('[stt] SpeechRecognition not supported in this browser')
      return
    }

    try {
      if (speechRecRef.current) {
        try { speechRecRef.current.abort?.() } catch {}
        try { speechRecRef.current.stop?.() } catch {}
      }

      if (isListening) {
        setIsListening(false)
        return
      }

      const rec = new SpeechRecognitionCtor()
      speechRecRef.current = rec
      rec.continuous = false
      rec.interimResults = false
      rec.lang = 'en-US'

      rec.onstart = () => {
        setIsListening(true)
      }

      rec.onerror = (e: any) => {
        console.warn('[stt] error', e)
        setIsListening(false)
      }

      rec.onend = () => {
        setIsListening(false)
      }

      rec.onresult = (event: any) => {
        const transcript = String(event?.results?.[0]?.[0]?.transcript ?? '').trim()
        if (transcript) {
          setConcept(prev => prev ? `${prev} ${transcript}` : transcript)
        }
        setIsListening(false)
      }

      rec.start()
    } catch (err) {
      console.warn('[stt] failed to start', err)
      setIsListening(false)
    }
  }, [isListening])

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
    <div className="flex flex-col items-center min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)] px-6 pt-[20vh]">
      <div className="absolute top-6 left-6 flex items-center gap-2">
        <Logo />
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-[color:var(--ink)]">Praxio</span>
      </div>
      
      <div className="w-full max-w-[var(--measure-lg)] mx-auto flex flex-col items-center">
        <h1 className="text-[28px] font-medium tracking-tight mb-10 text-center leading-tight">
          Master any concept through <br/><span className="text-[color:var(--ink3)]">interactive simulation</span>
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
            onClick={handleMic}
            className={`flex items-center justify-center w-[46px] h-[46px] shrink-0 rounded-[var(--r)] border transition-colors ${
              isListening
                ? 'bg-red-500/10 border-red-500 text-red-500 animate-pulse'
                : 'bg-white border-[color:var(--border)] text-[color:var(--ink2)] hover:border-[color:var(--border-strong)] shadow-[var(--shadow-sm)]'
            }`}
            title="Speak concept"
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
          <h2 className="text-[12px] uppercase tracking-[0.06em] text-[color:var(--ink3)] font-semibold mb-4">Examples</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button 
              onClick={() => router.push('/workspace/demo')}
              className="flex flex-col text-left p-4 rounded-[var(--r)] border border-[color:var(--border)] bg-[color:var(--surface)] hover:border-[color:var(--border-strong)] transition-colors shadow-sm"
            >
              <span className="text-[13px] font-medium text-[color:var(--ink)] mb-1">Projectile Motion (Demo)</span>
              <span className="text-[12px] text-[color:var(--ink2)] line-clamp-2">Understand the optimal launch angle for maximum range</span>
            </button>
            <button 
              onClick={() => router.push('/workspace/dev')}
              className="flex flex-col text-left p-4 rounded-[var(--r)] border border-[color:var(--border)] bg-[color:var(--surface)] hover:border-[color:var(--border-strong)] transition-colors shadow-sm"
            >
              <span className="text-[13px] font-medium text-[color:var(--ink)] mb-1">Projectile Motion (Dev)</span>
              <span className="text-[12px] text-[color:var(--ink2)] line-clamp-2">A more advanced episodic simulation of projectile physics</span>
            </button>
          </div>
        </div>
      </div>
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-[color:var(--bg)] text-[color:var(--ink)] px-6">
      <div className="flex items-center gap-2 mb-3">
        <Logo />
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-[color:var(--ink)]">Praxio</span>
      </div>
      <p className="text-[15px] text-[color:var(--ink2)] mb-10 max-w-[var(--measure-lg)] text-center leading-[1.45]">
        &ldquo;{concept}&rdquo;
      </p>

      <div className="w-[320px] flex flex-col gap-[14px] p-6 bg-[color:var(--surface)] border border-[color:var(--border)] rounded-[var(--r)] shadow-[var(--shadow-sm)]">
        {STEPS.map((s, i) => (
          <StepRow key={s.id} label={s.label} state={steps[i]} />
        ))}
      </div>

      <p className="mt-8 text-[11px] uppercase tracking-[0.06em] text-[color:var(--ink3)] font-mono">
        {allDone
          ? 'launching workspace...'
          : onSandbox
            ? 'handoff to runtime…'
            : 'streaming generation steps (retries may extend a stage)…'}
      </p>
    </div>
  )
}
