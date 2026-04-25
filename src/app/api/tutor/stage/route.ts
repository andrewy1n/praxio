import { generateText } from 'ai'
import { google } from '@ai-sdk/google'
import { buildTutorTools } from '@/lib/tutorTools'
import { buildCall1SystemPrompt } from '@/lib/prompts'
import type { StageRequest } from '@/lib/types'

const tutorModel = google('gemini-2.5-flash')

function appendSimEvents(messages: StageRequest['messages'], events: StageRequest['pendingEvents']) {
  if (events.length === 0) return messages
  const eventSummary = events.map(e => JSON.stringify(e)).join('\n')
  return [
    ...messages,
    { role: 'user' as const, content: `[SIM EVENTS]\n${eventSummary}` },
  ]
}

export async function POST(req: Request) {
  const { messages, pendingEvents, manifest, designDoc, activeSocraticStepId }: StageRequest = await req.json()

  const messagesWithEvents = appendSimEvents(messages, pendingEvents)

  const result = await generateText({
    model: tutorModel,
    system: buildCall1SystemPrompt(manifest, designDoc, activeSocraticStepId),
    messages: messagesWithEvents,
    tools: buildTutorTools(manifest),
    toolChoice: 'auto',
  })

  return Response.json({
    toolCalls: result.toolCalls.map(tc => ({ toolName: tc.toolName, input: tc.input })),
  })
}
