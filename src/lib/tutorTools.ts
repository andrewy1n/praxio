import { tool } from 'ai'
import { z } from 'zod'
import type { Manifest } from './types'

export function buildTutorTools(manifest: Manifest) {
  const paramNames = manifest.params.map(p => p.name) as [string, ...string[]]
  const regionNames = manifest.regions.length > 0
    ? manifest.regions as [string, ...string[]]
    : ['__none__'] as [string, ...string[]]
  const eventNames = manifest.events.length > 0
    ? manifest.events as [string, ...string[]]
    : ['__none__'] as [string, ...string[]]

  return {
    set_param: tool({
      description: 'Move a slider or set a variable to a specific value',
      inputSchema: z.object({
        name: z.enum(paramNames).describe('Param name from the manifest — must be verbatim'),
        value: z.number().describe('New value within the param range'),
      }),
    }),
    lock: tool({
      description: 'Remove a control from student reach temporarily to reduce degrees of freedom',
      inputSchema: z.object({
        element_id: z.enum(paramNames).describe('Param name to lock — must be verbatim'),
      }),
    }),
    unlock: tool({
      description: 'Restore a previously locked control to the student',
      inputSchema: z.object({
        element_id: z.enum(paramNames),
      }),
    }),
    highlight: tool({
      description: 'Apply visual emphasis (glow, border) to a parameter control in the sidebar to direct student attention. Params only — use add_annotation to call attention to a region inside the simulation.',
      inputSchema: z.object({
        element_id: z.enum(paramNames),
      }),
    }),
    add_annotation: tool({
      description: 'Pin a text label to a named simulation region',
      inputSchema: z.object({
        region: z.enum(regionNames).describe('Region name from the manifest — must be verbatim'),
        text: z.string().describe('Label or question to display'),
      }),
    }),
    clear_annotations: tool({
      description: 'Remove all active annotations from the simulation',
      inputSchema: z.object({}),
    }),
    checkpoint: tool({
      description: 'Snapshot full simulation state for what-if branching. Returns an opaque checkpoint ID.',
      inputSchema: z.object({}),
    }),
    restore: tool({
      description: 'Rewind simulation to a previous checkpoint',
      inputSchema: z.object({
        id: z.string().describe('Opaque checkpoint ID returned by a prior checkpoint call — must be verbatim'),
      }),
    }),
    trigger_event: tool({
      description: 'Introduce a perturbation into the simulation',
      inputSchema: z.object({
        type: z.enum(eventNames).describe('Event type from the manifest — must be verbatim'),
      }),
    }),
    set_scene: tool({
      description: 'Reset the simulation to a new initial condition',
      inputSchema: z.object({
        config: z.record(z.enum(paramNames), z.number()).describe('Param name → value overrides'),
      }),
    }),
    advance_step: tool({
      description:
        'Signal that the CURRENT Socratic step is satisfied (its exit_condition is met) and the session should move to the next step. Call this at most once per turn, and only when the student\'s latest action or utterance clearly fulfills the current step\'s exit_condition. Calling this triggers a UI transition to the next step after the speech reply finishes; do not call it just because the student spoke.',
      inputSchema: z.object({}),
    }),
  }
}
