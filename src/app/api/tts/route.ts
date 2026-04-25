const ELEVENLABS_TTS_MODEL = 'eleven_turbo_v2_5'
const ELEVENLABS_TTS_FORMAT = 'mp3_44100_128'

type TtsRequest = {
  text?: string
}

function getEnv(name: string): string {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

export async function POST(req: Request) {
  try {
    const { text }: TtsRequest = await req.json()
    const prompt = typeof text === 'string' ? text.trim() : ''
    if (!prompt) {
      return Response.json({ error: 'text is required' }, { status: 400 })
    }

    const apiKey = getEnv('ELEVENLABS_API_KEY') || getEnv('NEXT_PUBLIC_ELEVENLABS_KEY')
    const voiceId = getEnv('ELEVENLABS_VOICE_ID') || getEnv('NEXT_PUBLIC_ELEVENLABS_VOICE_ID')

    if (!apiKey || !voiceId) {
      return Response.json(
        { error: 'Missing ElevenLabs credentials in server env' },
        { status: 500 },
      )
    }

    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: prompt,
        model_id: ELEVENLABS_TTS_MODEL,
        output_format: ELEVENLABS_TTS_FORMAT,
      }),
    })

    if (!upstream.ok) {
      const body = await upstream.text()
      return Response.json(
        { error: 'ElevenLabs upstream error', status: upstream.status, body },
        { status: 502 },
      )
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error'
    return Response.json({ error: message }, { status: 500 })
  }
}
