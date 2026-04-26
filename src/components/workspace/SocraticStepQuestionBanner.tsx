'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Props = {
  question: string
  stepId: string
}

const FADE_OUT_LINE_MS = 150
const CARET_FADE_OUT_MS = 400

function nextCharDelayMs(): number {
  const base = 20 + Math.random() * 10
  return base + (Math.random() * 2 - 1) * 10
}

/**
 * Socratic step prompt — DM Sans (medium) typewriter in a light card, top center of the
 * main sim area. First visit per step animates; revisiting shows full text.
 */
export default function SocraticStepQuestionBanner({ question, stepId }: Props) {
  const [displayed, setDisplayed] = useState('')
  const [fadingOut, setFadingOut] = useState(false)
  const [showCaret, setShowCaret] = useState(false)
  const [caretFading, setCaretFading] = useState(false)
  const seenStepIdsRef = useRef<Set<string>>(new Set())
  const displayedRef = useRef('')

  useLayoutEffect(() => {
    displayedRef.current = displayed
  }, [displayed])

  useEffect(() => {
    if (!question || !stepId) return

    let cancelled = false
    const ids: number[] = []
    const t = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        if (!cancelled) fn()
      }, ms)
      ids.push(id)
    }
    const clearTimers = () => {
      ids.forEach(id => clearTimeout(id))
    }

    const reduced =
      typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduced) {
      setDisplayed(question)
      setFadingOut(false)
      setShowCaret(false)
      setCaretFading(false)
      seenStepIdsRef.current.add(stepId)
      return () => {
        cancelled = true
        clearTimers()
      }
    }

    if (seenStepIdsRef.current.has(stepId)) {
      setDisplayed(question)
      setFadingOut(false)
      setShowCaret(false)
      setCaretFading(false)
      return () => {
        cancelled = true
        clearTimers()
      }
    }

    setShowCaret(true)
    setCaretFading(false)
    setFadingOut(false)

    const hadPrevious = displayedRef.current.length > 0

    const finishCaret = () => {
      seenStepIdsRef.current.add(stepId)
      setCaretFading(true)
      t(() => {
        if (cancelled) return
        setShowCaret(false)
        setCaretFading(false)
      }, CARET_FADE_OUT_MS)
    }

    const runTyping = (full: string) => {
      if (full.length === 0) {
        setDisplayed('')
        seenStepIdsRef.current.add(stepId)
        setShowCaret(false)
        setCaretFading(false)
        return
      }
      let i = 0
      const step = () => {
        if (cancelled) return
        if (i >= full.length) {
          finishCaret()
          return
        }
        i += 1
        setDisplayed(full.slice(0, i))
        t(step, nextCharDelayMs())
      }
      setDisplayed('')
      step()
    }

    if (hadPrevious) {
      setFadingOut(true)
      t(() => {
        if (cancelled) return
        setDisplayed('')
        setFadingOut(false)
        runTyping(question)
      }, FADE_OUT_LINE_MS)
    } else {
      runTyping(question)
    }

    return () => {
      cancelled = true
      clearTimers()
    }
  }, [question, stepId])

  return (
    <div className="flex w-full justify-center" aria-live="polite">
      <div
        className="w-fit max-w-xl border bg-white px-5 py-3 text-center text-base font-medium font-[family-name:var(--font-dm-sans)] text-neutral-800 leading-snug shadow-[var(--shadow-sm)] sm:px-6 sm:py-4 rounded-[var(--r)]"
        style={{ borderColor: 'var(--border)' }}
      >
        <div
          className={
            'transition-opacity duration-150 ' + (fadingOut ? 'opacity-0' : 'opacity-100')
          }
        >
          <span>{displayed}</span>
          {showCaret ? (
            <span
              className={
                'ml-0.5 inline-block h-[1em] w-0.5 translate-y-px align-baseline bg-neutral-800 ' +
                (caretFading
                  ? 'opacity-0 transition-opacity ease-out motion-reduce:opacity-0'
                  : 'animate-pulse [animation-duration:1.05s] motion-reduce:animate-none')
              }
              style={
                caretFading
                  ? { transitionDuration: `${CARET_FADE_OUT_MS}ms` }
                  : undefined
              }
              aria-hidden
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
