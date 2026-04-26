import { streamText } from 'ai'
import { google } from '@ai-sdk/google'
import { buildCall2SystemPrompt } from '@/lib/prompts'
import type { SpeakRequest } from '@/lib/types'
import {
  assertWorkspaceSession,
  buildDefaultTransferQuestion,
  finalizeLastSocraticStepIfNeeded,
  getMainBranchForWorkspace,
  getWorkspaceDocForSession,
  markWorkspaceCompleted,
  persistBranchAfterTutorTurn,
  touchWorkspaceLastActive,
} from '@/lib/workspaceDb'

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
    sessionId,
    workspaceId,
  }: SpeakRequest = await req.json()

  const messagesWithEvents = appendSimEvents(messages, pendingEvents)

  const result = streamText({
    model: tutorModel,
    system: buildCall2SystemPrompt(manifest, designDoc, appliedToolCalls, activeSocraticStepId),
    messages: messagesWithEvents,
  })

  const skipDb =
    !workspaceId
    || workspaceId === 'dev'
    || workspaceId === 'demo'
    || !process.env.MONGODB_URI

  if (!skipDb) {
    void (async () => {
      try {
        const wid = workspaceId!
        await assertWorkspaceSession(wid, sessionId)
        const branch = await getMainBranchForWorkspace(wid)
        if (!branch) return

        const fullText = await result.text
        const finalMessages = [...messages, { role: 'assistant' as const, content: fullText }]

        await persistBranchAfterTutorTurn({
          workspaceId: wid,
          sessionId,
          branchId: branch.branchId,
          conversationHistory: finalMessages,
          currentSocraticStepId: activeSocraticStepId,
        })
        await touchWorkspaceLastActive(wid, sessionId)

        const userMessageCount = finalMessages.filter(m => m.role === 'user').length
        const { allPlanStepsComplete, completedStepIds } = await finalizeLastSocraticStepIfNeeded({
          workspaceId: wid,
          sessionId,
          activeSocraticStepId,
          userMessageCount,
        })

        if (allPlanStepsComplete) {
          const doc = await getWorkspaceDocForSession(wid, sessionId)
          if (doc && doc.status !== 'completed') {
            await markWorkspaceCompleted({
              workspaceId: wid,
              sessionId,
              completedStepIds,
              synthesis: fullText.slice(0, 2000).trim() || 'Session complete.',
              transferQuestion: buildDefaultTransferQuestion(doc.designDoc),
            })
          }
        }
      } catch (e) {
        console.error('[api/tutor/speak] persistence', e)
      }
    })()
  }

  return result.toTextStreamResponse()
}
