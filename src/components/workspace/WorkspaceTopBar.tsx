'use client'

import { useState } from 'react'
import Link from 'next/link'
import StepsDropdown from './StepsDropdown'

function formatStepLabel(id: string): string {
  return id
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.length ? (word[0].toUpperCase() + word.slice(1)) : word)
    .join(' ')
}

type Props = {
  conceptTitle: string
  socraticSteps: { id: string }[]
  activeStepId: string | null
  completedStepIds: string[]
  onSelectStep: (stepId: string) => void
}

export default function WorkspaceTopBar({
  conceptTitle,
  socraticSteps,
  activeStepId,
  completedStepIds,
  onSelectStep,
}: Props) {
  const [stepsOpen, setStepsOpen] = useState(false)

  const activeIndex = socraticSteps.findIndex(s => s.id === activeStepId)
  const activeStepLabel =
    activeStepId && activeIndex >= 0 ? `${activeIndex + 1}. ${formatStepLabel(activeStepId)}` : '…'

  return (
    <header className="relative z-[100] flex h-[54px] shrink-0 items-center gap-3 border-b border-[color:var(--border)] bg-[rgba(255,255,255,0.92)] px-5 font-[family-name:var(--font-dm-sans)] backdrop-blur-md">
      <Link
        href="/"
        className="flex shrink-0 items-center gap-1.5 rounded-md outline-none ring-offset-2 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[color:var(--accent-border)]"
        title="New concept"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ borderRadius: '5px' }}
        >
          <rect width="22" height="22" fill="var(--accent)" />
          <circle cx="11" cy="11" r="4.5" fill="white" fillOpacity="0.9" />
          <rect x="7.5" y="7.5" width="7" height="7" rx="1.5" fill="white" fillOpacity="0.8" transform="rotate(45 11 11)" />
        </svg>
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-[color:var(--ink)]">Praxio</span>
      </Link>

      <div className="h-5 w-px shrink-0 bg-[color:var(--border)]" />

      <p className="min-w-0 flex-1 truncate text-[14px] text-[color:var(--ink2)]">{conceptTitle || '…'}</p>

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => socraticSteps.length > 0 && setStepsOpen(o => !o)}
          disabled={socraticSteps.length === 0}
          className={`flex max-w-[200px] items-center gap-1 rounded-full border py-0.5 pl-2 pr-2 font-[family-name:var(--font-dm-mono)] text-xs font-medium outline-none transition-colors ${
            socraticSteps.length === 0 ? 'cursor-not-allowed opacity-50' : ''
          } ${
            stepsOpen
              ? 'border-[color:var(--accent-border)] bg-[color:var(--accent-light)] text-[color:var(--ink2)]'
              : 'border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--ink2)] hover:border-[color:var(--border-strong)]'
          }`}
        >
          <span className="text-[9px] text-[color:var(--accent)]">◆</span>
          <span className="min-w-0 truncate">{activeStepLabel}</span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            className={`ml-0.5 shrink-0 opacity-40 transition-transform ${stepsOpen ? 'rotate-180' : ''}`}
            aria-hidden
          >
            <path
              d="M2 4 L5 7 L8 4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {stepsOpen && socraticSteps.length > 0 && (
          <StepsDropdown
            steps={socraticSteps}
            activeStepId={activeStepId}
            completedStepIds={completedStepIds}
            onSelectStep={onSelectStep}
            onClose={() => setStepsOpen(false)}
          />
        )}
      </div>

      <div
        className="flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded-full bg-gradient-to-br from-[oklch(75%_0.12_280)] to-[oklch(65%_0.14_240)] text-[11px] font-semibold text-white"
        title="Demo user"
      >
        U
      </div>
    </header>
  )
}
