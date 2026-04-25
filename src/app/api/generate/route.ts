import {
  GenerationFailedError,
  runGenerationPipeline,
} from '@/lib/generationPipeline'
import type { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  const streamProgress = req.nextUrl.searchParams.get('stream') === '1'
  try {
    const body = await req.json()
    const concept = typeof body?.concept === 'string' ? body.concept.trim() : ''

    if (!concept) {
      return Response.json({ error: 'Concept is required', phase: 'pass1' }, { status: 400 })
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
              write({ type: 'result', result: debug ? { ...rest, trace } : rest })
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

    if (debug) {
      return Response.json({ ...rest, trace })
    }

    return Response.json(rest)
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
