'use client'

import { useState } from 'react'
import type { TutorMessage } from '@/lib/types'

export type TutorStripState = 'idle' | 'processing' | 'tutor speaking' | 'listening'

type Props = {
  messages: TutorMessage[]
  onSend: (text: string) => void
  onMic?: () => void
  tutorState: TutorStripState
  simEventHint?: string | null
  showSimHint?: boolean
}

function Waveform({ state }: { state: TutorStripState }) {
  const heights = [8, 16, 22, 12, 18, 22, 10, 20, 14, 22, 8, 16, 12, 20, 6]
  const flatH = [4, 6, 4, 5, 4, 6, 4, 5, 4, 6, 4, 5, 4, 6, 4]
  const listening = state === 'listening'
  const speaking = state === 'tutor speaking'
  const active = speaking || listening
  const bars = active ? heights : flatH
  const color = listening ? 'oklch(55% 0.15 30)' : 'var(--accent)'

  return (
    <div className="flex h-[22px] items-center gap-0.5">
      {bars.map((h, i) => (
        <div
          key={i}
          className="rounded-sm"
          style={{
            width: 2.5,
            height: h,
            background: active ? color : 'var(--ink4)',
            animation: active
              ? `praxio-wave ${0.6 + i * 0.05}s ease-in-out ${i * 0.04}s infinite alternate`
              : 'none',
          }}
        />
      ))}
    </div>
  )
}

function statusVisual(state: TutorStripState, colorVar: string) {
  if (state === 'idle') {
    return <div className="h-1.5 w-1.5 shrink-0 rounded-full border-[1.5px]" style={{ borderColor: colorVar }} />
  }
  if (state === 'processing') {
    return (
      <div className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-solid border-[oklch(68%_0.14_82)] border-t-transparent" />
    )
  }
  return (
    <div
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: colorVar, animation: 'praxio-pulse-dot 1.6s ease-in-out infinite' }}
    />
  )
}

export default function WorkspaceTutorStrip({
  messages,
  onSend,
  onMic,
  tutorState,
  simEventHint,
  showSimHint = true,
}: Props) {
  const [inputVal, setInputVal] = useState('')

  const lastTutorMsg = [...messages].reverse().find(m => m.role === 'assistant')
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
  const lastUserIdx = lastUserMsg ? messages.lastIndexOf(lastUserMsg) : -1
  const lastTutorIdx = lastTutorMsg ? messages.lastIndexOf(lastTutorMsg) : -1
  const userSentAwaitingTutor = lastUserIdx > lastTutorIdx
  const isBusy = tutorState !== 'idle'

  const sentStatusText =
    tutorState === 'processing'
      ? 'sending to tutor…'
      : tutorState === 'tutor speaking'
        ? 'tutor is responding…'
        : userSentAwaitingTutor
          ? 'sent to tutor'
          : null

  const statusColors: Record<TutorStripState, string> = {
    'tutor speaking': 'var(--accent)',
    listening: 'oklch(55% 0.15 30)',
    idle: 'var(--ink3)',
    processing: 'oklch(68% 0.14 82)',
  }
  const statusColor = statusColors[tutorState]
  const statusWords =
    tutorState === 'tutor speaking'
      ? 'tutor speaking'
      : tutorState === 'listening'
        ? 'listening'
        : tutorState === 'processing'
          ? 'processing'
          : 'idle'
  const statusPrefix = tutorState === 'idle' ? '○ ' : tutorState === 'processing' ? '' : '● '

  const handleSend = () => {
    const next = inputVal.trim()
    if (!next) return
    if (isBusy) return
    onSend(next)
    setInputVal('')
  }
  const hasDraft = inputVal.trim().length > 0
  const isListening = tutorState === 'listening'
  // Mic is clickable when idle (to start) OR when listening (to stop).
  // Disabled during processing / tutor speaking so we don't interrupt an
  // in-flight tutor turn.
  const canMic = Boolean(onMic) && !hasDraft && (tutorState === 'idle' || isListening)

  return (
    <footer data-tutor-strip="true" className="z-[100] flex h-[var(--tutor-strip-h)] shrink-0 items-stretch border-t border-[color:var(--border)] bg-[color:var(--bg)] font-[family-name:var(--font-dm-sans)]">
      <div className="flex w-[var(--tutor-status-w)] shrink-0 flex-col justify-center gap-1.5 border-r border-[color:var(--border)] px-4">
        <div
          className="flex items-center gap-1.5 font-[family-name:var(--font-dm-mono)] text-[11px] font-medium"
          style={{ color: statusColor }}
        >
          {statusVisual(tutorState, statusColor)}
          <span>
            {statusPrefix}
            {statusWords}
          </span>
        </div>
        <Waveform state={tutorState} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 overflow-hidden px-5 py-3">
        {lastUserMsg ? (
          <div className="max-h-[40px] overflow-y-auto pr-2">
            <p className="text-sm leading-snug tracking-tight text-[color:var(--ink)]">
              <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-wider text-[color:var(--ink3)]">User:&nbsp;</span>
              {lastUserMsg.content}
            </p>
          </div>
        ) : null}

        {sentStatusText ? (
          <p className="flex items-center gap-1.5 font-[family-name:var(--font-dm-mono)] text-[11px] text-[color:var(--ink3)]">
            {tutorState === 'processing' ? (
              <span className="inline-block h-2 w-2 animate-spin rounded-full border-[1.5px] border-solid border-[oklch(68%_0.14_82)] border-t-transparent" />
            ) : (
              <span className="inline-block h-1 w-1 rounded-full bg-[color:var(--ink3)]" />
            )}
            {sentStatusText}
          </p>
        ) : null}

        {lastTutorMsg ? (
          <div className="max-h-[44px] overflow-y-auto pr-2">
            <p className="text-sm leading-snug tracking-tight text-[color:var(--ink)] [&_strong]:font-semibold">
              <span className="font-[family-name:var(--font-dm-mono)] text-[11px] uppercase tracking-wider text-[color:var(--ink3)]">Tutor:&nbsp;</span>
              {lastTutorMsg.content}
            </p>
          </div>
        ) : !lastUserMsg ? (
          <p className="text-sm italic text-[color:var(--ink3)]">Waiting for tutor…</p>
        ) : null}

        {showSimHint && simEventHint ? (
          <p className="truncate font-[family-name:var(--font-dm-mono)] text-[11px] text-[color:var(--ink3)]">{simEventHint}</p>
        ) : null}
      </div>

      <div className="flex w-[var(--tutor-input-w)] shrink-0 items-center gap-2 border-l border-[color:var(--border)] px-3">
        <input
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="type reply…"
          disabled={isBusy}
          className="h-[34px] min-w-0 flex-1 rounded border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 text-xs text-[color:var(--ink)] outline-none transition-colors placeholder:text-[color:var(--ink3)] focus:border-[color:var(--accent-border)] focus:bg-[color:var(--bg)]"
        />
        <button
          type="button"
          title={
            hasDraft
              ? isBusy
                ? 'Tutor is busy…'
                : 'Send'
              : isListening
                ? 'Stop & transcribe'
                : isBusy
                  ? 'Tutor is busy…'
                  : onMic
                    ? 'Speak (STT)'
                    : 'Speak (STT) unavailable'
          }
          aria-label={
            hasDraft
              ? 'Send message'
              : isListening
                ? 'Stop recording and transcribe'
                : 'Speak (STT)'
          }
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded border-0 text-white transition-colors hover:opacity-90 disabled:opacity-50"
          style={{
            background: isListening ? 'oklch(55% 0.15 30)' : 'var(--ink)',
          }}
          disabled={hasDraft ? isBusy : !canMic}
          onClick={hasDraft ? handleSend : onMic}
        >
          {hasDraft ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 19V5" strokeLinecap="round" />
              <path d="M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : isListening ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          )}
        </button>
      </div>
    </footer>
  )
}
