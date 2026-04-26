import {
  assertWorkspaceSession,
  deleteWorkspaceForSession,
  getMainBranchForWorkspace,
  markWorkspaceCompleted,
  patchWorkspaceMetadata,
  setBranchCurrentStep,
} from '@/lib/workspaceDb'
import { normalizeCompletionSummaryDetail } from '@/lib/completionSummaryNormalize'
import type { GetWorkspaceResponse, SessionCompletionState, UpdateWorkspaceRequest } from '@/lib/types'
import type { NextRequest } from 'next/server'

type RouteParams = { params: Promise<{ workspaceId: string }> }

function toCompletionState(
  doc: Awaited<ReturnType<typeof assertWorkspaceSession>>,
): SessionCompletionState | undefined {
  if (doc.completion) {
    let summary = normalizeCompletionSummaryDetail(doc.completion.summary)
    if (!summary) {
      summary = normalizeCompletionSummaryDetail({
        synthesis: doc.completionSummary ?? doc.learningArtifact?.finalSynthesis ?? 'Session complete.',
      })
    }
    if (!summary) {
      summary = {
        title: 'Session complete',
        synthesis: 'Session complete.',
        evidence: ['Session completed.'],
      }
    }
    return {
      ...doc.completion,
      summary,
    }
  }
  if (doc.status !== 'completed') return undefined
  const synthesis = doc.completionSummary ?? doc.learningArtifact?.finalSynthesis ?? ''
  const summary = normalizeCompletionSummaryDetail({ synthesis }) ?? {
    title: 'Session complete',
    synthesis: synthesis || 'Session complete.',
    evidence: synthesis ? [synthesis.length > 180 ? `${synthesis.slice(0, 177)}…` : synthesis] : ['Session completed.'],
  }
  return {
    isComplete: true,
    completedStepIds: doc.completedStepIds ?? [],
    completedAt: doc.completedAt ? new Date(doc.completedAt).getTime() : undefined,
    summary,
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
        completedStepIds: doc.completedStepIds ?? [],
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
        summary: {
          title: 'Session complete',
          synthesis,
          evidence: [
            'You completed every step in this workspace.',
            'Open a new concept when you are ready for more.',
          ],
        },
      })
    } else {
      await patchWorkspaceMetadata(workspaceId, sessionId, json)
    }

    if (json.currentSocraticStepId !== undefined) {
      const branch = await getMainBranchForWorkspace(workspaceId)
      if (branch) {
        await setBranchCurrentStep({
          branchId: branch.branchId,
          workspaceId,
          sessionId,
          currentSocraticStepId: json.currentSocraticStepId,
        })
      }
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

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { workspaceId } = await params
  const sessionId = req.nextUrl.searchParams.get('sessionId')?.trim() ?? ''
  if (!sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 })
  }

  try {
    await deleteWorkspaceForSession(workspaceId, sessionId)
    return Response.json({ ok: true as const })
  } catch (e) {
    const status = (e as Error & { status?: number }).status ?? 500
    if (status === 404) {
      return Response.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }
    const msg = e instanceof Error ? e.message : 'Delete failed'
    console.error('[api/workspaces/[id] DELETE]', e)
    return Response.json({ error: msg }, { status: 500 })
  }
}
