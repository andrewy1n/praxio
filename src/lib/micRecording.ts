// Preferred MediaRecorder mime types, in order. Browsers fall through to the
// first one they actually support (Safari needs mp4/aac, Chrome/Firefox prefer
// webm/opus). ElevenLabs Scribe auto-detects codec from the file payload.
const MIC_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

export function pickSupportedMimeType(): string | undefined {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return undefined
  }
  for (const type of MIC_MIME_CANDIDATES) {
    try {
      if (window.MediaRecorder.isTypeSupported?.(type)) return type
    } catch {
      /* ignore */
    }
  }
  return undefined
}
