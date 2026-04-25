import {
  assertWorkspaceSession,
  buildDefaultTransferQuestion,
  getMainBranchForWorkspace,
  markWorkspaceCompleted,
  patchWorkspaceMetadata,
} from '@/lib/workspaceDb'
import type { GetWorkspaceResponse, SessionCompletionState, UpdateWorkspaceRequest } from '@/lib/types'
import type { NextRequest } from 'next/server'

type RouteParams = { params: Promise<{ workspaceId: string }> }

function toCompletionState(
  doc: Awaited<ReturnType<typeof assertWorkspaceSession>>,
): SessionCompletionState | undefined {
  if (doc.completion) return doc.completion
  if (doc.status !== 'completed') return undefined
  const synthesis = doc.completionSummary ?? doc.learningArtifact?.finalSynthesis ?? ''
  const transferQuestion
    = doc.learningArtifact?.transferQuestion ?? buildDefaultTransferQuestion(doc.designDoc)
  return {
    isComplete: true,
    completedStepIds: doc.completedStepIds ?? [],
    completedAt: doc.completedAt ? new Date(doc.completedAt).getTime() : undefined,
    summary: { synthesis, transferQuestion },
  }
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { workspaceId } = await params
  const sessionId = req.nextUrl.searchParams.get('sessionId')?.trim() ?? ''
  if (!sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 })
  }

  try {
    const doc = await assertWorkspaceSession(workspaceId, sessionId)
    const branchDoc = await getMainBranchForWorkspace(workspaceId)

    const body: GetWorkspaceResponse = {
      workspace: {
        workspaceId: doc.workspaceId,
        sessionId: doc.sessionId,
        concept: doc.concept,
        domain: doc.domain,
        renderer: doc.renderer,
        designDoc: doc.designDoc,
        status: doc.status,
        createdAt: doc.createdAt.toISOString(),
        lastActiveAt: (doc.lastActiveAt ?? doc.createdAt).toISOString(),
        completedAt: doc.completedAt?.toISOString(),
        simCode: doc.simCode,
      },
      completion: toCompletionState(doc),
    }

    if (branchDoc) {
      body.branch = {
        branchId: branchDoc.branchId,
        name: branchDoc.name,
        checkpoints: branchDoc.checkpoints,
        conversationHistory: branchDoc.conversationHistory,
        currentSocraticStepId: branchDoc.currentSocraticStepId,
      }
    }

    return Response.json(body)
  } catch (e) {
    const status = (e as Error & { status?: number }).status ?? 500
    if (status === 404) {
      return Response.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }
    const msg = e instanceof Error ? e.message : 'Get workspace failed'
    console.error('[api/workspaces/[id] GET]', e)
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { workspaceId } = await params
  let json: UpdateWorkspaceRequest
  try {
    json = (await req.json()) as UpdateWorkspaceRequest
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sessionId = typeof json.sessionId === 'string' ? json.sessionId.trim() : ''
  if (!sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 })
  }

  try {
    const doc = await assertWorkspaceSession(workspaceId, sessionId)

    if (json.status === 'completed' && doc.status !== 'completed') {
      const completedStepIds = json.completedStepIds?.length
        ? json.completedStepIds
        : doc.completedStepIds?.length
          ? doc.completedStepIds
          : doc.designDoc.socratic_plan.map(s => s.id)
      const synthesis = json.completionSummary ?? 'Session complete.'
      await markWorkspaceCompleted({
        workspaceId,
        sessionId,
        completedStepIds,
        synthesis,
        transferQuestion: buildDefaultTransferQuestion(doc.designDoc),
      })
    } else {
      await patchWorkspaceMetadata(workspaceId, sessionId, json)
    }

    return Response.json({ ok: true as const })
  } catch (e) {
    const status = (e as Error & { status?: number }).status ?? 500
    if (status === 404) {
      return Response.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }
    const msg = e instanceof Error ? e.message : 'Patch failed'
    console.error('[api/workspaces/[id] PATCH]', e)
    return Response.json({ error: msg }, { status: 500 })
  }
}
