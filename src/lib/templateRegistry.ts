import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { DesignDocSchema, type DesignDoc } from './types'

/** Preset folder under public/presets/ */
const DOMAIN_TO_PRESET: Record<DesignDoc['domain'], string | null> = {
  physics: 'projectile-motion',
  math: 'unit-circle',
  biology: 'population-growth',
  chemistry: null,
  general: null,
}

export type LoadedTemplate = {
  id: string
  designDoc: DesignDoc
  simCode: string
}

export function getPresetIdForDomain(domain: DesignDoc['domain']): string | null {
  return DOMAIN_TO_PRESET[domain] ?? null
}

async function loadPresetById(id: string): Promise<LoadedTemplate | null> {
  const base = path.join(process.cwd(), 'public', 'presets', id)
  try {
    const [docRaw, code] = await Promise.all([
      readFile(path.join(base, 'design-doc.json'), 'utf8'),
      readFile(path.join(base, 'sim.js'), 'utf8'),
    ])
    const parsed = DesignDocSchema.safeParse(JSON.parse(docRaw))
    if (!parsed.success) return null
    return { id, designDoc: parsed.data, simCode: code }
  } catch {
    return null
  }
}

export async function loadTemplateByDomain(
  domain: DesignDoc['domain'],
): Promise<LoadedTemplate | null> {
  const id = getPresetIdForDomain(domain)
  if (!id) return null
  return loadPresetById(id)
}

export async function loadTemplateById(id: string): Promise<LoadedTemplate | null> {
  return loadPresetById(id)
}
