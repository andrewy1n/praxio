import { ensurePraxioIndexes } from '@/lib/mongodb'
import { listWorkspacesBySession } from '@/lib/workspaceDb'
import type { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    await ensurePraxioIndexes()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Database unavailable'
    return Response.json({ error: msg }, { status: 503 })
  }

  const sessionId = req.nextUrl.searchParams.get('sessionId')?.trim() ?? ''
  if (!sessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 })
  }

  let limit = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10)
  if (!Number.isFinite(limit) || limit < 1) limit = 20
  if (limit > 50) limit = 50

  try {
    const items = await listWorkspacesBySession(sessionId, limit)
    return Response.json({ items })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'List failed'
    console.error('[api/workspaces GET]', e)
    return Response.json({ error: msg }, { status: 500 })
  }
}
