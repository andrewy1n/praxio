import type {
  Branch,
  DesignDoc,
  SessionCompletionState,
  SessionLearningArtifact,
  TutorMessage,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceListItem,
  WorkspaceStatus,
} from '@/lib/types'
import { getDb, ensurePraxioIndexes } from '@/lib/mongodb'
import type { Document } from 'mongodb'

const WORKSPACES = 'workspaces'
const STEPS = 'steps'

export type WorkspaceDoc = Workspace & Document

function toIso(d: Date | undefined | null): string | undefined {
  if (!d) return undefined
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString()
}

function normalizeStatus(s: unknown): WorkspaceStatus {
  return s === 'completed' ? 'completed' : 'in_progress'
}

export function workspaceToListItem(doc: WorkspaceDoc): WorkspaceListItem {
  const lastActiveAt = doc.lastActiveAt ?? doc.createdAt
  return {
    workspaceId: doc.workspaceId,
    concept: doc.concept,
    domain: doc.domain,
    renderer: doc.renderer,
    status: normalizeStatus(doc.status),
    createdAt: toIso(doc.createdAt) ?? new Date().toISOString(),
    lastActiveAt: toIso(lastActiveAt) ?? new Date().toISOString(),
    completedAt: toIso(doc.completedAt),
    completionSummary: doc.completionSummary,
  }
}

export async function createWorkspaceWithMainBranch(input: {
  workspaceId: string
  sessionId: string
  concept: string
  designDoc: DesignDoc
  simCode: string
}): Promise<void> {
  await ensurePraxioIndexes()
  const db = await getDb()
  const workspaces = db.collection<WorkspaceDoc>(WORKSPACES)
  const steps = db.collection<Branch & Document>(STEPS)

  const now = new Date()
  const firstStepId = input.designDoc.socratic_plan[0]?.id

  const workspace: WorkspaceDoc = {
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    concept: input.concept.trim(),
    domain: input.designDoc.domain,
    renderer: input.designDoc.renderer,
    designDoc: input.designDoc,
    simCode: input.simCode,
    status: 'in_progress',
    createdAt: now,
    lastActiveAt: now,
    completedStepIds: [],
  }

  await workspaces.insertOne(workspace)

  const branchId = crypto.randomUUID()
  const branch: Branch & Document = {
    branchId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    name: 'main',
    checkpoints: [],
    conversationHistory: [],
    currentSocraticStepId: firstStepId,
    createdAt: now,
  }
  await steps.insertOne(branch)
}

export async function listWorkspacesBySession(
  sessionId: string,
  limit: number,
): Promise<WorkspaceListItem[]> {
  await ensurePraxioIndexes()
  const db = await getDb()
  const coll = db.collection<WorkspaceDoc>(WORKSPACES)
  const cursor = coll
    .find({ sessionId })
    .sort({ lastActiveAt: -1, createdAt: -1 })
    .limit(limit)

  const docs = await cursor.toArray()
  return docs.map(workspaceToListItem)
}

export async function getWorkspaceDocForSession(
  workspaceId: string,
  sessionId: string,
): Promise<WorkspaceDoc | null> {
  await ensurePraxioIndexes()
  const db = await getDb()
  const coll = db.collection<WorkspaceDoc>(WORKSPACES)
  const doc = await coll.findOne({ workspaceId, sessionId })
  return doc
}

export async function getMainBranchForWorkspace(workspaceId: string): Promise<(Branch & Document) | null> {
  await ensurePraxioIndexes()
  const db = await getDb()
  const coll = db.collection<Branch & Document>(STEPS)
  return coll.findOne({ workspaceId, name: 'main' })
}

export async function assertWorkspaceSession(
  workspaceId: string,
  sessionId: string,
): Promise<WorkspaceDoc> {
  const doc = await getWorkspaceDocForSession(workspaceId, sessionId)
  if (!doc) {
    const err = new Error('Workspace not found or access denied')
    ;(err as Error & { status: number }).status = 404
    throw err
  }
  return doc
}

export async function touchWorkspaceLastActive(
  workspaceId: string,
  sessionId: string,
  at: Date = new Date(),
): Promise<void> {
  const db = await getDb()
  const coll = db.collection<WorkspaceDoc>(WORKSPACES)
  await coll.updateOne(
    { workspaceId, sessionId },
    { $set: { lastActiveAt: at } },
  )
}

export async function patchWorkspaceMetadata(
  workspaceId: string,
  sessionId: string,
  body: UpdateWorkspaceRequest,
): Promise<void> {
  await assertWorkspaceSession(workspaceId, sessionId)
  const db = await getDb()
  const coll = db.collection<WorkspaceDoc>(WORKSPACES)

  const $set: Record<string, unknown> = {}
  if (body.status !== undefined) $set.status = body.status
  if (body.lastActiveAt !== undefined) $set.lastActiveAt = new Date(body.lastActiveAt)
  if (body.completedAt !== undefined) $set.completedAt = new Date(body.completedAt)
  if (body.completionSummary !== undefined) $set.completionSummary = body.completionSummary
  if (body.completedStepIds !== undefined) $set.completedStepIds = body.completedStepIds

  if (Object.keys($set).length === 0) return

  await coll.updateOne({ workspaceId, sessionId }, { $set })
}

export async function persistBranchAfterTutorTurn(input: {
  workspaceId: string
  sessionId: string
  branchId: string
  conversationHistory: TutorMessage[]
  currentSocraticStepId?: string
}): Promise<void> {
  const db = await getDb()
  const coll = db.collection<Branch & Document>(STEPS)
  const $set: Record<string, unknown> = {
    conversationHistory: input.conversationHistory,
  }
  if (input.currentSocraticStepId !== undefined) {
    $set.currentSocraticStepId = input.currentSocraticStepId
  }
  await coll.updateOne(
    { branchId: input.branchId, workspaceId: input.workspaceId, sessionId: input.sessionId },
    { $set },
  )
}

export async function setBranchCurrentStep(input: {
  branchId: string
  workspaceId: string
  sessionId: string
  currentSocraticStepId?: string
}): Promise<void> {
  const db = await getDb()
  const coll = db.collection<Branch & Document>(STEPS)
  await coll.updateOne(
    { branchId: input.branchId, workspaceId: input.workspaceId, sessionId: input.sessionId },
    { $set: { currentSocraticStepId: input.currentSocraticStepId } },
  )
}

/**
 * When the student changes the active Socratic step, treat the previous step as completed.
 * Returns whether every step id in the plan is now marked complete.
 */
export async function applySocraticStepTransition(input: {
  workspaceId: string
  sessionId: string
  previousStepId: string | undefined
  nextStepId: string | undefined
}): Promise<{ completedStepIds: string[]; allPlanStepsComplete: boolean }> {
  const doc = await getWorkspaceDocForSession(input.workspaceId, input.sessionId)
  if (!doc) {
    const err = new Error('Workspace not found')
    ;(err as Error & { status: number }).status = 404
    throw err
  }

  const planIds = doc.designDoc.socratic_plan.map(s => s.id)
  const completed = new Set(doc.completedStepIds ?? [])

  if (
    input.previousStepId
    && input.nextStepId
    && input.previousStepId !== input.nextStepId
    && planIds.includes(input.previousStepId)
  ) {
    completed.add(input.previousStepId)
  }

  const completedStepIds = planIds.filter(id => completed.has(id))
  const allPlanStepsComplete
    = planIds.length > 0 && planIds.every(id => completed.has(id))

  const db = await getDb()
  const coll = db.collection<WorkspaceDoc>(WORKSPACES)
  await coll.updateOne(
    { workspaceId: input.workspaceId, sessionId: input.sessionId },
    { $set: { completedStepIds } },
  )

  return { completedStepIds, allPlanStepsComplete }
}

/**
 * Marks the final Socratic step complete when the student remains on the last step
 * (no dropdown transition). Call after each speak turn.
 */
export async function finalizeLastSocraticStepIfNeeded(input: {
  workspaceId: string
  sessionId: string
  activeSocraticStepId: string | undefined
  /** Count of user turns in this session; avoids closing the plan before any student reply on the last step. */
  userMessageCount: number
}): Promise<{ completedStepIds: string[]; allPlanStepsComplete: boolean }> {
  const doc = await getWorkspaceDocForSession(input.workspaceId, input.sessionId)
  if (!doc) {
    const err = new Error('Workspace not found')
    ;(err as Error & { status: number }).status = 404
    throw err
  }

  const planIds = doc.designDoc.socratic_plan.map(s => s.id)
  const lastId = planIds[planIds.length - 1]
  const completed = new Set(doc.completedStepIds ?? [])

  if (
    lastId
    && input.activeSocraticStepId === lastId
    && planIds.slice(0, -1).every(id => completed.has(id))
    && input.userMessageCount >= 2
  ) {
    completed.add(lastId)
  }

  const completedStepIds = planIds.filter(id => completed.has(id))
  const allPlanStepsComplete
    = planIds.length > 0 && planIds.every(id => completed.has(id))

  const db = await getDb()
  const coll = db.collection<WorkspaceDoc>(WORKSPACES)
  await coll.updateOne(
    { workspaceId: input.workspaceId, sessionId: input.sessionId },
    { $set: { completedStepIds } },
  )

  return { completedStepIds, allPlanStepsComplete }
}

export async function markWorkspaceCompleted(input: {
  workspaceId: string
  sessionId: string
  completedStepIds: string[]
  synthesis: string
  transferQuestion: string
}): Promise<void> {
  const now = new Date()
  const completion: SessionCompletionState = {
    isComplete: true,
    completedStepIds: input.completedStepIds,
    completedAt: now.getTime(),
    summary: {
      synthesis: input.synthesis,
      transferQuestion: input.transferQuestion,
    },
  }

  const artifact: SessionLearningArtifact = {
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    completedStepIds: input.completedStepIds,
    keyMoments: [],
    finalSynthesis: input.synthesis,
    transferQuestion: input.transferQuestion,
    createdAt: now,
  }

  const db = await getDb()
  const coll = db.collection<WorkspaceDoc>(WORKSPACES)
  await coll.updateOne(
    { workspaceId: input.workspaceId, sessionId: input.sessionId },
    {
      $set: {
        status: 'completed' as const,
        completedAt: now,
        lastActiveAt: now,
        completionSummary: input.synthesis.slice(0, 500),
        completedStepIds: input.completedStepIds,
        completion,
        learningArtifact: artifact,
      },
    },
  )
}

export function buildDefaultTransferQuestion(designDoc: DesignDoc): string {
  const concept = designDoc.concept.trim()
  return `How would this change if we altered one key parameter in "${concept}" and re-ran the scenario?`
}
