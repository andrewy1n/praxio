const ELEVENLABS_STT_MODEL = 'scribe_v1'
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
// Default ISO-639-3 language code. Override via ELEVENLABS_STT_LANGUAGE env or
// a `language_code` multipart field from the client. Locking this prevents
// Scribe from drifting to Spanish/French on ambient noise and producing
// localized audio-event tags like `(sonido de transición)`.
const DEFAULT_STT_LANGUAGE = 'eng'

function getEnv(name: string): string {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Strip parenthetical audio-event tags like `(laughter)`, `(footsteps)`,
 * `(sonido de transición)`. Scribe still emits these even with
 * tag_audio_events=false in some edge cases (non-speech-only clips), and
 * feeding them to the tutor would derail the conversation.
 */
function stripAudioEventTags(text: string): string {
  return text
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export async function POST(req: Request) {
  try {
    const apiKey = getEnv('ELEVENLABS_API_KEY') || getEnv('NEXT_PUBLIC_ELEVENLABS_KEY')
    if (!apiKey) {
      return Response.json(
        { error: 'Missing ElevenLabs credentials in server env' },
        { status: 500 },
      )
    }

    let incoming: FormData
    try {
      incoming = await req.formData()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'invalid multipart body'
      return Response.json(
        { error: `Expected multipart/form-data body with audio "file" field: ${message}` },
        { status: 400 },
      )
    }
    const file = incoming.get('file')

    if (!(file instanceof Blob)) {
      return Response.json(
        { error: 'multipart field "file" (audio blob) is required' },
        { status: 400 },
      )
    }
    if (file.size === 0) {
      return Response.json({ error: 'audio blob is empty' }, { status: 400 })
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return Response.json(
        { error: `audio exceeds ${MAX_AUDIO_BYTES} bytes` },
        { status: 413 },
      )
    }

    // Scribe accepts the raw audio as `file`; forward with a sane filename so
    // ElevenLabs infers codec correctly for browsers that emit webm/ogg.
    const filename = typeof (file as File).name === 'string' && (file as File).name
      ? (file as File).name
      : 'speech.webm'

    const clientLanguage = incoming.get('language_code')
    const languageCodeToSend =
      typeof clientLanguage === 'string' && clientLanguage.trim()
        ? clientLanguage.trim()
        : getEnv('ELEVENLABS_STT_LANGUAGE') || DEFAULT_STT_LANGUAGE

    const outgoing = new FormData()
    outgoing.append('model_id', ELEVENLABS_STT_MODEL)
    outgoing.append('file', file, filename)
    outgoing.append('language_code', languageCodeToSend)
    // Keep transcriptions clean: no "(laughter)", "(transition sound)" inserts.
    outgoing.append('tag_audio_events', 'false')

    const upstream = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: outgoing,
    })

    if (!upstream.ok) {
      const body = await upstream.text()
      return Response.json(
        { error: 'ElevenLabs upstream error', status: upstream.status, body },
        { status: 502 },
      )
    }

    const data = (await upstream.json()) as {
      text?: string
      language_code?: string
      language_probability?: number
    }

    const rawText = typeof data.text === 'string' ? data.text.trim() : ''
    const text = stripAudioEventTags(rawText)

    return Response.json({
      text,
      rawText,
      languageCode: data.language_code ?? null,
      languageProbability:
        typeof data.language_probability === 'number' ? data.language_probability : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error'
    return Response.json({ error: message }, { status: 500 })
  }
}
