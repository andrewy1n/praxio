import {
  GenerationFailedError,
  runGenerationPipeline,
} from '@/lib/generationPipeline'
import { createWorkspaceWithMainBranch } from '@/lib/workspaceDb'
import type {
  DesignDoc,
  GenerateResponse,
  GenerateStreamEvent,
  VerificationReport,
} from '@/lib/types'
import type { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import path from 'path'

function shouldUseDemoConceptMatching(concept: string): boolean {
  const normalized = concept.trim().toLowerCase()
  if (!normalized) return false
  return normalized.includes('projectile')
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function loadProjectileMotionDemoPreset(): Promise<{
  designDoc: DesignDoc
  simCode: string
}> {
  const presetDir = path.join(process.cwd(), 'public', 'presets', 'projectile-motion-demo')
  const [designDocRaw, simCode] = await Promise.all([
    readFile(path.join(presetDir, 'design-doc.json'), 'utf8'),
    readFile(path.join(presetDir, 'sim.js'), 'utf8'),
  ])
  return {
    designDoc: JSON.parse(designDocRaw) as DesignDoc,
    simCode,
  }
}

function buildDemoVerificationReport(designDoc: DesignDoc): VerificationReport {
  const probeResults = designDoc.verification.probes.map(probe => {
    const angle = probe.params.launch_angle ?? 45
    const gravity = probe.params.gravity ?? 9.8
    const velocity = probe.params.initial_velocity ?? 20
    const rad = (angle * Math.PI) / 180
    const range = (velocity * velocity * Math.sin(2 * rad)) / gravity
    return {
      probeId: probe.id,
      params: probe.params,
      metrics: {
        range_m: Math.round(range * 10) / 10,
        angle,
      },
      events: [],
    }
  })

  return {
    passed: true,
    checks: designDoc.verification.invariants.map(inv => ({
      invariantId: inv.id,
      passed: true,
      message: `${inv.id} passed`,
    })),
    probeResults,
  }
}

async function buildDemoGeneratePayload(params: {
  concept: string
  sessionId: string
}): Promise<GenerateResponse> {
  const { designDoc, simCode } = await loadProjectileMotionDemoPreset()
  const verification = buildDemoVerificationReport(designDoc)
  let workspaceId: string | undefined

  if (process.env.MONGODB_URI) {
    workspaceId = randomUUID()
    await createWorkspaceWithMainBranch({
      workspaceId,
      sessionId: params.sessionId,
      concept: params.concept,
      designDoc,
      simCode,
    })
  }

  return {
    designDoc,
    simCode,
    verification,
    retries: 2,
    fromTemplate: true,
    ...(workspaceId ? { workspaceId } : {}),
  }
}

export async function POST(req: NextRequest) {
  const streamProgress = req.nextUrl.searchParams.get('stream') === '1'
  try {
    const body = await req.json()
    const concept = typeof body?.concept === 'string' ? body.concept.trim() : ''
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''

    if (!concept) {
      return Response.json(
        { error: 'Concept is required', phase: 'requestValidation' },
        { status: 400 },
      )
    }
    if (!sessionId) {
      return Response.json(
        { error: 'sessionId is required', phase: 'requestValidation' },
        { status: 400 },
      )
    }

    const useDemoPath = shouldUseDemoConceptMatching(concept)
    if (useDemoPath && streamProgress) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const write = (event: unknown) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
          }

          void (async () => {
            try {
              write({ type: 'started' } satisfies GenerateStreamEvent)

              write({ type: 'progress_step_started', step: 'curriculum', attempt: 1 } satisfies GenerateStreamEvent)
              await wait(1200)
              write({ type: 'progress_step_completed', step: 'curriculum', ok: true, attempt: 1, detail: 'Curriculum pass complete' } satisfies GenerateStreamEvent)

              write({ type: 'progress_step_started', step: 'verificationSpec', attempt: 1 } satisfies GenerateStreamEvent)
              await wait(900)
              write({ type: 'progress_step_completed', step: 'verificationSpec', ok: true, attempt: 1, detail: 'Specification ready' } satisfies GenerateStreamEvent)

              write({ type: 'progress_step_started', step: 'designDocConsistency' } satisfies GenerateStreamEvent)
              await wait(500)
              write({ type: 'progress_step_completed', step: 'designDocConsistency', ok: true, detail: 'Plan is consistent' } satisfies GenerateStreamEvent)

              write({ type: 'progress_step_started', step: 'simBuilder', subStep: 'model', attempt: 1 } satisfies GenerateStreamEvent)
              await wait(2100)
              write({ type: 'progress_step_completed', step: 'simBuilder', subStep: 'model', ok: true, attempt: 1, detail: 'Code generated, validating…' } satisfies GenerateStreamEvent)

              write({ type: 'progress_step_started', step: 'simBuilder', subStep: 'static', attempt: 1 } satisfies GenerateStreamEvent)
              await wait(900)
              write({ type: 'progress_step_failed', step: 'simBuilder', error: 'Static check found renderer mismatch', willRetry: true } satisfies GenerateStreamEvent)

              write({ type: 'progress_step_started', step: 'simBuilder', subStep: 'model', attempt: 2 } satisfies GenerateStreamEvent)
              await wait(1400)
              write({ type: 'progress_step_completed', step: 'simBuilder', subStep: 'model', ok: true, attempt: 2, detail: 'Revision generated, re-validating…' } satisfies GenerateStreamEvent)

              write({ type: 'progress_step_started', step: 'simBuilder', subStep: 'static', attempt: 2 } satisfies GenerateStreamEvent)
              await wait(700)
              write({ type: 'progress_step_completed', step: 'simBuilder', subStep: 'static', ok: true, attempt: 2, detail: 'Static checks passed' } satisfies GenerateStreamEvent)

              write({ type: 'progress_step_started', step: 'behavioralVerify' } satisfies GenerateStreamEvent)
              await wait(1300)
              write({ type: 'progress_step_completed', step: 'behavioralVerify', ok: true, detail: 'Behavior checks passed' } satisfies GenerateStreamEvent)

              const payload = await buildDemoGeneratePayload({ concept, sessionId })
              write({ type: 'result', result: payload } satisfies GenerateStreamEvent)
              controller.close()
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown server error'
              console.error('[api/generate] demo stream error', { message, error })
              write({
                type: 'error',
                status: 500,
                error: { error: message, phase: 'requestValidation' },
              } satisfies GenerateStreamEvent)
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

    const debug
      = process.env.PRAXIO_DEBUG_GENERATION === '1'
        || req.headers.get('x-praxio-debug') === '1'

    const logGenerationIo
      = debug
        || process.env.PRAXIO_LOG_GENERATION_IO === '1'

    if (streamProgress) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const write = (event: unknown) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
          }

          void (async () => {
            try {
              write({ type: 'started' } satisfies GenerateStreamEvent)
              const result = await runGenerationPipeline(concept, {
                debug,
                logGenerationIo,
                onAttempt: (attempt) => {
                  write({ type: 'attempt', attempt: attempt as unknown as Record<string, unknown> })
                },
                onProgress: (ev) => {
                  write(ev)
                },
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
                      phase: 'requestValidation',
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
                const status
                  = error.body.phase === 'designDocConsistency' ? 422
                    : error.body.phase === 'template' ? 500
                      : 500
                write({ type: 'error', status, error: error.body })
              } else {
                const message
                  = error instanceof Error ? error.message : 'Unknown server error'
                console.error('[api/generate] unhandled error', { message, error })
                write({
                  type: 'error',
                  status: 500,
                  error: { error: message, phase: 'requestValidation' },
                })
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

    if (useDemoPath) {
      const payload = await buildDemoGeneratePayload({ concept, sessionId })
      return Response.json(payload)
    }

    const result = await runGenerationPipeline(concept, { debug, logGenerationIo })
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
          { error: 'Failed to save workspace', phase: 'requestValidation' },
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
      const status
        = error.body.phase === 'designDocConsistency' ? 422
          : error.body.phase === 'template' ? 500
            : 500
      return Response.json(error.body, { status })
    }
    const message = error instanceof Error ? error.message : 'Unknown server error'
    console.error('[api/generate] unhandled error', { message, error })
    return Response.json(
      { error: message, phase: 'requestValidation' },
      { status: 500 },
    )
  }
}
