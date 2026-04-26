'use client'

import type { SessionCompletionSummaryDetail } from '@/lib/types'

type Props = {
  conceptTitle: string
  summary: SessionCompletionSummaryDetail
  onNewConcept: () => void
  onKeepExploring: () => void
}

export default function SessionCompletionOverlay({
  conceptTitle,
  summary,
  onNewConcept,
  onKeepExploring,
}: Props) {
  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-[color:var(--ink)]/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-completion-title"
    >
      <div
        className="pointer-events-auto flex max-h-[min(90vh,640px)] w-full max-w-[var(--measure-lg)] flex-col overflow-y-auto rounded-[var(--r)] border border-[color:var(--border)] bg-[color:var(--bg)] shadow-[var(--shadow-md)]"
      >
        <div className="border-b border-[color:var(--border)] bg-[color:var(--surface)] px-6 py-4">
          <p className="font-[family-name:var(--font-dm-mono)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--accent)]">
            Session complete
          </p>
          <h2
            id="session-completion-title"
            className="mt-1 font-[family-name:var(--font-dm-sans)] text-xl font-semibold tracking-tight text-[color:var(--ink)] sm:text-2xl"
          >
            {summary.title}
          </h2>
          {conceptTitle ? (
            <p className="mt-0.5 text-sm text-[color:var(--ink2)]">{conceptTitle}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 px-6 py-5">
          <p className="text-[15px] leading-relaxed text-[color:var(--ink)]">{summary.synthesis}</p>

          {summary.evidence.length > 0 ? (
            <div>
              <p className="mb-2 font-[family-name:var(--font-dm-mono)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--ink3)]">
                What you did
              </p>
              <ul className="list-inside list-disc space-y-1.5 text-sm text-[color:var(--ink2)]">
                {summary.evidence.map((line, i) => (
                  <li key={i} className="leading-snug">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {summary.nextPrompt ? (
            <p className="rounded-[var(--r)] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-3 text-sm italic text-[color:var(--ink2)]">
              {summary.nextPrompt}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={onNewConcept}
              className="rounded-[var(--r)] bg-[color:var(--ink)] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              New concept
            </button>
            <button
              type="button"
              onClick={onKeepExploring}
              className="rounded-[var(--r)] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2.5 text-sm font-medium text-[color:var(--ink2)] transition-colors hover:border-[color:var(--border-strong)]"
            >
              Keep exploring
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
