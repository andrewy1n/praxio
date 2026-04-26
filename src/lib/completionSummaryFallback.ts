import type { CompletionSummaryInput, SessionCompletionSummaryDetail } from '@/lib/types'

function fallbackSummary(concept: string): SessionCompletionSummaryDetail {
  return {
    title: 'Session complete',
    synthesis: `You finished exploring ${concept}. Great work walking through every discovery step.`,
    evidence: [
      'You completed all steps in this session.',
      'Come back anytime to explore a new concept.',
    ],
  }
}

export function buildCompletionSummaryFallback(input: CompletionSummaryInput): SessionCompletionSummaryDetail {
  const plan = input.designDoc.socratic_plan
  const completed = new Set(input.completedStepIds)
  const stepsDone = plan.filter(s => completed.has(s.id))
  const goals = stepsDone.map(s => s.learning_goal).filter(Boolean)
  const evidence = goals.slice(0, 3).map(g => `Worked toward: ${g}`)
  if (evidence.length === 0) {
    return fallbackSummary(input.designDoc.concept)
  }
  return {
    title: `You explored ${input.designDoc.concept}`,
    synthesis: `You completed this session on ${input.designDoc.concept}, moving through ${stepsDone.length} guided step(s).`,
    evidence: evidence.length >= 1 ? evidence : fallbackSummary(input.designDoc.concept).evidence,
    nextPrompt: undefined,
  }
}
