'use client'

import { useState } from 'react'
import type { TutorMessage } from '@/lib/types'

type Props = {
  messages: TutorMessage[]
  onSend: (text: string) => void
  isSpeaking: boolean
  isListening?: boolean
}

function WaveformBars({ active, listening }: { active: boolean; listening: boolean }) {
  const color = listening ? '#f87171' : '#fb923c'
  const heights = [10, 22, 32, 18, 28, 14, 26, 20, 30]
  return (
    <div className="flex items-center gap-0.5 h-8">
      {heights.map((h, i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            width: 3,
            borderRadius: 2,
            background: color,
            height: active ? h : 4,
            opacity: active ? 1 : 0.3,
            transition: 'height 0.3s ease, opacity 0.3s ease',
            transformOrigin: 'center',
          }}
        />
      ))}
    </div>
  )
}

export default function TutorPanel({ messages, onSend, isSpeaking, isListening = false }: Props) {
  const [inputVal, setInputVal] = useState('')

  const lastTutorMsg = [...messages].reverse().find(m => m.role === 'assistant')

  const statusLabel = isSpeaking
    ? '● tutor speaking'
    : isListening
    ? '● listening'
    : '○ idle'

  const statusColor = isSpeaking
    ? 'text-orange-400'
    : isListening
    ? 'text-red-400'
    : 'text-zinc-600'

  const handleSend = () => {
    if (!inputVal.trim()) return
    onSend(inputVal.trim())
    setInputVal('')
  }

  return (
    <div className="h-20 shrink-0 flex items-stretch bg-zinc-900 border-t border-zinc-700/60">
      {/* Waveform section */}
      <div className="w-44 border-r border-zinc-800 flex flex-col items-center justify-center gap-1 px-4">
        <span className={`text-[10px] font-mono uppercase tracking-wider transition-colors ${statusColor}`}>
          {statusLabel}
        </span>
        <WaveformBars active={isSpeaking || isListening} listening={isListening} />
      </div>

      {/* Tutor question */}
      <div className="flex-1 flex flex-col justify-center px-5 gap-1">
        {lastTutorMsg ? (
          <p className="text-sm text-zinc-100 leading-snug line-clamp-2">{lastTutorMsg.content}</p>
        ) : (
          <p className="text-sm text-zinc-600 italic">Waiting for tutor…</p>
        )}
      </div>

      {/* Student input */}
      <div className="w-52 border-l border-zinc-800 flex flex-col justify-center gap-2 px-3.5">
        <input
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="type reply…"
          className="bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none placeholder-zinc-600 focus:border-orange-400/60"
        />
        <button
          onClick={() => { /* TODO: Person B — trigger ElevenLabs STT */ }}
          className="h-7 flex items-center justify-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-400 hover:text-orange-400 hover:border-orange-400/60 transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
          </svg>
          speak
        </button>
      </div>
    </div>
  )
}
