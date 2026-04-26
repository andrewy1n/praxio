import type { SessionCompletionSummaryDetail } from '@/lib/types'

/**
 * Gemini sometimes writes "45 r" / "30 r" instead of degrees. Normalize obvious cases.
 * Pattern: small integer + optional space + lone "r" (word boundary) → °
 */
export function sanitizeAngleAbbreviations(text: string): string {
  return text.replace(/\b(\d{1,3})\s*[rR]\b/g, '$1°')
}

export function sanitizeCompletionSummaryAngles(detail: SessionCompletionSummaryDetail): SessionCompletionSummaryDetail {
  return {
    title: sanitizeAngleAbbreviations(detail.title),
    synthesis: sanitizeAngleAbbreviations(detail.synthesis),
    evidence: detail.evidence.map(sanitizeAngleAbbreviations),
    nextPrompt: detail.nextPrompt ? sanitizeAngleAbbreviations(detail.nextPrompt) : undefined,
  }
}
