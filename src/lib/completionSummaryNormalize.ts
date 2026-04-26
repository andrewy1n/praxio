import { sanitizeCompletionSummaryAngles } from '@/lib/completionSummaryAngleFix'
import type { SessionCompletionSummaryDetail } from '@/lib/types'

/** Normalize legacy DB/API shapes where summary was only `{ synthesis: string }`. */
export function normalizeCompletionSummaryDetail(s: unknown): SessionCompletionSummaryDetail | undefined {
  if (!s || typeof s !== 'object') return undefined
  const o = s as Record<string, unknown>
  const synthesis = typeof o.synthesis === 'string' ? o.synthesis.trim() : ''
  if (!synthesis) return undefined
  const title = typeof o.title === 'string' ? o.title.trim() : 'Session complete'
  const rawEvidence = Array.isArray(o.evidence) ? o.evidence : []
  const evidence = rawEvidence.filter((x): x is string => typeof x === 'string').map(e => e.trim()).filter(Boolean)
  const nextPrompt = typeof o.nextPrompt === 'string' ? o.nextPrompt.trim() : undefined
  return sanitizeCompletionSummaryAngles({
    title: title || 'Session complete',
    synthesis,
    evidence: evidence.length > 0 ? evidence : [synthesis.length > 180 ? `${synthesis.slice(0, 177)}…` : synthesis],
    nextPrompt: nextPrompt || undefined,
  })
}
