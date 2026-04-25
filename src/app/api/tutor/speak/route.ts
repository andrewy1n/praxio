import { streamText } from 'ai'
import { google } from '@ai-sdk/google'
import { buildCall2SystemPrompt } from '@/lib/prompts'
import type { SpeakRequest } from '@/lib/types'

const tutorModel = google('gemini-2.5-flash')

function appendSimEvents(messages: SpeakRequest['messages'], events: SpeakRequest['pendingEvents']) {
  if (events.length === 0) return messages
  const eventSummary = events.map(e => JSON.stringify(e)).join('\n')
  return [
    ...messages,
    { role: 'user' as const, content: `[SIM EVENTS]\n${eventSummary}` },
  ]
}

export async function POST(req: Request) {
  const {
    messages,
    pendingEvents,
    manifest,
    designDoc,
    appliedToolCalls,
    activeSocraticStepId,
  }: SpeakRequest = await req.json()

  const messagesWithEvents = appendSimEvents(messages, pendingEvents)

  const result = streamText({
    model: tutorModel,
    system: buildCall2SystemPrompt(manifest, designDoc, appliedToolCalls, activeSocraticStepId),
    messages: messagesWithEvents,
  })

  return result.toTextStreamResponse()
}
