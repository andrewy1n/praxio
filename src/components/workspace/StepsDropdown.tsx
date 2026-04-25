'use client'

import { useEffect, useRef } from 'react'

function formatStepLabel(id: string): string {
  return id
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.length ? (word[0].toUpperCase() + word.slice(1)) : word)
    .join(' ')
}

type Props = {
  steps: { id: string }[]
  activeStepId: string | null
  completedStepIds: string[]
  onSelectStep: (stepId: string) => void
  onClose: () => void
}

export default function StepsDropdown({ steps, activeStepId, completedStepIds, onSelectStep, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const completed = new Set(completedStepIds)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-[calc(100%+6px)] z-[200] w-[260px] origin-top-right overflow-hidden rounded-lg border bg-[color:var(--bg)] [animation:praxio-scale-in_0.15s_ease]"
      style={{
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-xl)',
      }}
    >
      <div className="border-b px-3.5 py-2.5 pb-2" style={{ borderColor: 'var(--border)' }}>
        <span className="font-[family-name:var(--font-dm-mono)] text-[11px] font-semibold uppercase tracking-[0.07em] text-[color:var(--ink3)]">
          Steps
        </span>
      </div>

      <div className="max-h-[320px] overflow-y-auto">
        {steps.map((step, i) => {
          const isActive = activeStepId === step.id
          const isDone = completed.has(step.id)
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => {
                onSelectStep(step.id)
                onClose()
              }}
              className={`flex w-full cursor-pointer select-none items-center gap-1.5 border-l-2 px-3.5 py-2 text-left transition-colors ${
                isActive
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-light)]'
                  : 'border-transparent hover:bg-[color:var(--surface)]'
              }`}
            >
              <span className="shrink-0 text-[11px] text-[color:var(--accent)]">◆</span>
              <span
                className={`min-w-0 flex-1 truncate font-[family-name:var(--font-dm-mono)] text-[12px] ${
                  isActive ? 'font-medium text-[color:var(--ink)]' : 'font-normal text-[color:var(--ink)]'
                }`}
              >
                {i + 1}. {formatStepLabel(step.id)}
              </span>
              {isDone && !isActive && (
                <span
                  className="shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink3)' }}
                >
                  ✓
                </span>
              )}
              {isActive && (
                <span className="shrink-0 rounded-full bg-[color:var(--accent)] px-1.5 py-px text-[10px] font-medium text-white">
                  active
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
