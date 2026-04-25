import { DesignDocSchema, type Pass1Diagnosis } from '@/lib/types'

/** Strip fences, take outermost `{`…`}` slice, JSON.parse */
export function extractJsonFromModelText(
  text: string | undefined,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text?.trim()) return { ok: false, error: 'empty model text' }

  let s = text.trim()
  if (s.startsWith('```')) {
    const firstNl = s.indexOf('\n')
    if (firstNl !== -1) s = s.slice(firstNl + 1)
    const fence = s.lastIndexOf('```')
    if (fence !== -1) s = s.slice(0, fence)
    s = s.trim()
  }

  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, error: 'no JSON object found in model text' }
  }

  const slice = s.slice(start, end + 1)
  try {
    return { ok: true, value: JSON.parse(slice) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'JSON.parse failed'
    return { ok: false, error: msg }
  }
}

function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return '(root)'
  let s = ''
  for (const seg of path) {
    if (typeof seg === 'number') s += `[${seg}]`
    else s += (s === '' ? '' : '.') + String(seg)
  }
  return s
}

/** Re-run extraction + Zod locally — explains most `NoObjectGeneratedError` failures. */
export function diagnosePass1ModelText(text: string | undefined): Pass1Diagnosis {
  const extracted = extractJsonFromModelText(text)
  if (!extracted.ok) return { parseError: extracted.error, zodIssues: [] }

  const r = DesignDocSchema.safeParse(extracted.value)
  if (r.success) {
    return { zodIssues: [], localSchemaOk: true }
  }

  const zodIssues = r.error.issues.slice(0, 24).map(issue => ({
    path: formatIssuePath(issue.path as PropertyKey[]),
    message: issue.message,
  }))
  return { zodIssues }
}
