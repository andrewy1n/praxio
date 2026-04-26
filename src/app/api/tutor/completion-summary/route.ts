import { generateSessionCompletionSummary } from '@/lib/completionSummary'
import type { DesignDoc, TutorMessage } from '@/lib/types'

type Body = {
  designDoc: DesignDoc
  completedStepIds: string[]
  messages: TutorMessage[]
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body.designDoc?.socratic_plan || !Array.isArray(body.completedStepIds) || !Array.isArray(body.messages)) {
    return Response.json({ error: 'designDoc, completedStepIds, and messages are required' }, { status: 400 })
  }

  try {
    const summary = await generateSessionCompletionSummary({
      designDoc: body.designDoc,
      completedStepIds: body.completedStepIds,
      messages: body.messages,
    })
    return Response.json(summary)
  } catch (e) {
    console.error('[api/tutor/completion-summary]', e)
    return Response.json({ error: 'Summary generation failed' }, { status: 500 })
  }
}
