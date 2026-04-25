import {
  GenerationFailedError,
  runGenerationPipeline,
} from '@/lib/generationPipeline'
import { createWorkspaceWithMainBranch } from '@/lib/workspaceDb'
import type { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'

export async function POST(req: NextRequest) {
  const streamProgress = req.nextUrl.searchParams.get('stream') === '1'
  try {
    const body = await req.json()
    const concept = typeof body?.concept === 'string' ? body.concept.trim() : ''
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''

    if (!concept) {
      return Response.json({ error: 'Concept is required', phase: 'pass1' }, { status: 400 })
    }
    if (!sessionId) {
      return Response.json({ error: 'sessionId is required', phase: 'pass1' }, { status: 400 })
    }

    const debug =
      process.env.PRAXIO_DEBUG_GENERATION === '1'
      || req.headers.get('x-praxio-debug') === '1'

    if (streamProgress) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const write = (event: unknown) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
          }

          void (async () => {
            try {
              write({ type: 'started' })
              const result = await runGenerationPipeline(concept, {
                debug,
                onAttempt: (attempt) => write({ type: 'attempt', attempt }),
              })
              const { trace, ...rest } = result
              let workspaceId: string | undefined
              if (process.env.MONGODB_URI) {
                try {
                  workspaceId = randomUUID()
                  await createWorkspaceWithMainBranch({
                    workspaceId,
                    sessionId,
                    concept,
                    designDoc: rest.designDoc,
                    simCode: rest.simCode,
                  })
                } catch (persistErr) {
                  console.error('[api/generate] workspace persist', persistErr)
                  write({
                    type: 'error',
                    status: 503,
                    error: {
                      error: 'Failed to save workspace',
                      phase: 'pass1',
                    },
                  })
                  controller.close()
                  return
                }
              }
              const payload = { ...rest, ...(workspaceId ? { workspaceId } : {}) }
              write({ type: 'result', result: debug ? { ...payload, trace } : payload })
              controller.close()
            } catch (error) {
              if (error instanceof GenerationFailedError) {
                const status =
                  error.body.phase === 'designDocConsistency' ? 422
                    : error.body.phase === 'template' ? 500
                      : 500
                write({ type: 'error', status, error: error.body })
              } else {
                const message = error instanceof Error ? error.message : 'Unknown server error'
                console.error('[api/generate] unhandled error', { message, error })
                write({ type: 'error', status: 500, error: { error: message, phase: 'pass1' } })
              }
              controller.close()
            }
          })()
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
        },
      })
    }

    const result = await runGenerationPipeline(concept, { debug })
    const { trace, ...rest } = result

    let workspaceId: string | undefined
    if (process.env.MONGODB_URI) {
      try {
        workspaceId = randomUUID()
        await createWorkspaceWithMainBranch({
          workspaceId,
          sessionId,
          concept,
          designDoc: rest.designDoc,
          simCode: rest.simCode,
        })
      } catch (persistErr) {
        console.error('[api/generate] workspace persist', persistErr)
        return Response.json(
          { error: 'Failed to save workspace', phase: 'pass1' },
          { status: 503 },
        )
      }
    }

    const payload = { ...rest, ...(workspaceId ? { workspaceId } : {}) }

    if (debug) {
      return Response.json({ ...payload, trace })
    }

    return Response.json(payload)
  } catch (error) {
    if (error instanceof GenerationFailedError) {
      const status =
        error.body.phase === 'designDocConsistency' ? 422
        : error.body.phase === 'template' ? 500
        : 500
      return Response.json(error.body, { status })
    }
    const message = error instanceof Error ? error.message : 'Unknown server error'
    console.error('[api/generate] unhandled error', { message, error })
    return Response.json({ error: message, phase: 'pass1' }, { status: 500 })
  }
}
