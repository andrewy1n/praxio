import { generateText } from 'ai'
import { google } from '@ai-sdk/google'
import { buildTutorTools } from '@/lib/tutorTools'
import { buildCall1SystemPrompt } from '@/lib/prompts'
import type { StageRequest } from '@/lib/types'
import {
  applySocraticStepTransition,
  assertWorkspaceSession,
  getMainBranchForWorkspace,
  setBranchCurrentStep,
  touchWorkspaceLastActive,
} from '@/lib/workspaceDb'

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
  const {
    messages,
    pendingEvents,
    manifest,
    designDoc,
    activeSocraticStepId,
    sessionId,
    workspaceId,
  }: StageRequest = await req.json()

  const skipDb = !workspaceId || workspaceId === 'dev' || !process.env.MONGODB_URI

  if (!skipDb) {
    await assertWorkspaceSession(workspaceId!, sessionId)
    const branch = await getMainBranchForWorkspace(workspaceId)
    if (!branch) {
      return Response.json({ error: 'Branch not found' }, { status: 404 })
    }
    await applySocraticStepTransition({
      workspaceId: workspaceId!,
      sessionId,
      previousStepId: branch.currentSocraticStepId,
      nextStepId: activeSocraticStepId,
    })
    await setBranchCurrentStep({
      branchId: branch.branchId,
      workspaceId: workspaceId!,
      sessionId,
      currentSocraticStepId: activeSocraticStepId,
    })
    await touchWorkspaceLastActive(workspaceId!, sessionId)
  }

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
