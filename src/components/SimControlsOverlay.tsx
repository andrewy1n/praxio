'use client'

import type { Manifest } from '@/lib/types'

type Phase = 'idle' | 'active' | 'done'

type Props = {
  manifest: Manifest
  phase: Phase
  paused: boolean
  onLaunch: () => void
  onPause: () => void
  onPlay: () => void
  onReset: () => void
}

/** Bottom-right sim transport — UX.md SimControls; episodic + animates gates from manifest. */
export default function SimControlsOverlay({
  manifest,
  phase,
  paused,
  onLaunch,
  onPause,
  onPlay,
  onReset,
}: Props) {
  if (!manifest.animates) return null

  const { episodic } = manifest
  let mode: 'launch' | 'pause' | 'play' | 'reset' | null = null
  if (episodic && phase === 'idle') mode = 'launch'
  else if (episodic && phase === 'done') mode = 'reset'
  else if (phase === 'active' && !paused) mode = 'pause'
  else if (phase === 'active' && paused) mode = 'play'
  else if (!episodic && phase === 'active' && !paused) mode = 'pause'
  else if (!episodic && phase === 'active' && paused) mode = 'play'

  if (mode === null) return null

  const phaseLabel = paused ? 'paused' : phase
  const configs = {
    launch: {
      label: 'Launch',
      bg: 'var(--accent)',
      onClick: onLaunch,
      icon: <polygon points="0,0 10,5 0,10" fill="white" />,
    },
    pause: {
      label: 'Pause',
      bg: 'var(--ink)',
      onClick: onPause,
      icon: (
        <>
          <rect x="0" y="0" width="3.5" height="10" rx="1" fill="white" />
          <rect x="6.5" y="0" width="3.5" height="10" rx="1" fill="white" />
        </>
      ),
    },
    play: {
      label: 'Play',
      bg: 'var(--ink)',
      onClick: onPlay,
      icon: <polygon points="0,0 10,5 0,10" fill="white" />,
    },
    reset: {
      label: 'Reset',
      bg: 'var(--border-strong)',
      onClick: onReset,
      icon: (
        <path
          d="M9 2A7 7 0 1 0 14 7"
          stroke="white"
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      ),
    },
  } as const

  const cfg = configs[mode]

  return (
    <div className="pointer-events-auto absolute bottom-6 right-4 z-20 flex flex-col items-end gap-1">
      <span className="font-[family-name:var(--font-dm-mono)] text-[10px] font-medium uppercase tracking-[0.06em] text-[color:var(--ink4)]">
        Sim · {phaseLabel}
      </span>
      <button
        type="button"
        onClick={cfg.onClick}
        className="flex cursor-pointer items-center gap-2 rounded border-0 px-[18px] py-2 text-[13px] font-medium tracking-tight transition-[opacity,transform] active:scale-[0.97] hover:opacity-90"
        style={{
          background: cfg.bg,
          color: 'white',
          boxShadow: 'var(--shadow-sm)',
          fontFamily: 'var(--font-dm-sans), system-ui, sans-serif',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          {cfg.icon}
        </svg>
        {cfg.label}
      </button>
    </div>
  )
}
