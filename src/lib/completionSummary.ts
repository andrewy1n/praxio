import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { sanitizeCompletionSummaryAngles } from '@/lib/completionSummaryAngleFix'
import { buildCompletionSummaryFallback } from '@/lib/completionSummaryFallback'
import type { CompletionSummaryInput, SessionCompletionSummaryDetail } from '@/lib/types'

const completionSummaryModel = google('gemini-2.5-flash')

export const SessionCompletionSummarySchema = z.object({
  title: z.string().max(120).describe('Short headline, e.g. You cracked projectile range'),
  synthesis: z
    .string()
    .max(900)
    .describe('2–4 short sentences: what they discovered, grounded in the transcript. No questions.'),
  evidence: z
    .array(z.string().max(220))
    .min(1)
    .max(3)
    .describe('Bullets tied to student actions or quotes from the conversation'),
  nextPrompt: z
    .string()
    .max(240)
    .optional()
    .describe('One optional transfer question; omit if none fits'),
})

export async function generateSessionCompletionSummary(
  input: CompletionSummaryInput,
): Promise<SessionCompletionSummaryDetail> {
  const plan = input.designDoc.socratic_plan
  const completed = new Set(input.completedStepIds)
  const stepsBlock = plan
    .filter(s => completed.has(s.id))
    .map(s => `- ${s.id}: goal=${s.learning_goal}; question=${s.question}`)
    .join('\n')

  const transcript = input.messages
    .slice(-40)
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n')

  const system = `
You write a session completion recap for a learning app (Praxio).
The tutor uses Socratic questioning; the recap is NOT another lesson.
Rules:
- Ground every claim in the provided transcript or completed-step goals. If the transcript is thin, keep claims modest.
- synthesis: celebratory but specific; no questions in this field.
- evidence: 1–3 bullets; reference what the student did or said when possible.
- nextPrompt: at most one short optional transfer question; omit the field if nothing fits.
- Never fabricate numbers or sim outcomes not present in the transcript.
- Angles: write degrees as ° (e.g. 45°) or the word "degrees". Never use "r" alone after a number — that is wrong.
`.trim()

  const prompt = `
Concept: ${input.designDoc.concept}
Domain: ${input.designDoc.domain}

Completed steps (subset of plan):
${stepsBlock || '(none listed)'}

Conversation (most recent last):
${transcript || '(empty)'}
`.trim()

  try {
    const { object } = await generateObject({
      model: completionSummaryModel,
      schema: SessionCompletionSummarySchema,
      system,
      prompt,
    })
    return sanitizeCompletionSummaryAngles({
      title: object.title.trim(),
      synthesis: object.synthesis.trim(),
      evidence: object.evidence.map(e => e.trim()).filter(Boolean),
      nextPrompt: object.nextPrompt?.trim() || undefined,
    })
  } catch (e) {
    console.warn('[completionSummary] generateObject failed', e)
    return sanitizeCompletionSummaryAngles(buildCompletionSummaryFallback(input))
  }
}
