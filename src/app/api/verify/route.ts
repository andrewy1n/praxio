import { verifySimBehavior } from '@/lib/verification'
import { DesignDocSchema } from '@/lib/types'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { simCode, designDoc: rawDesignDoc } = body

    if (typeof simCode !== 'string' || !simCode.trim()) {
      return Response.json({ error: 'simCode is required' }, { status: 400 })
    }

    const parsed = DesignDocSchema.safeParse(rawDesignDoc)
    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid designDoc', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const verification = await verifySimBehavior(simCode, parsed.data)
    return Response.json(verification)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return Response.json({ error: message }, { status: 500 })
  }
}
