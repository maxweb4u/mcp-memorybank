import type { Layer } from './types.js'

const BY_DIR: Record<string, Layer> = {
  dna: 'dna',

  product: 'knowledge',
  domain: 'knowledge',
  engineering: 'knowledge',
  ops: 'knowledge',
  system: 'knowledge',
  services: 'knowledge',
  research: 'knowledge',
  strategies: 'knowledge',

  adr: 'decision',
  'use-cases': 'decision',
  'use_cases': 'decision',
  prd: 'decision',

  features: 'delivery',
  epics: 'delivery',
  tasks: 'delivery',

  flows: 'flow',
  processes: 'flow',
  prompts: 'flow',

  _inbox: 'inbox',
}

/** Ranking weight per layer. Delivery is damped: in large banks it is ~80% of the corpus. */
export const LAYER_WEIGHT: Record<Layer, number> = {
  knowledge: 1.5,
  decision: 1.2,
  dna: 1.0,
  flow: 1.0,
  other: 1.0,
  delivery: 0.6,
  // Quarantine: excluded from routing and search outright, so this weight only ever applies if a
  // caller reaches a note some other way. Kept low rather than removed, to fail quiet if it does.
  inbox: 0.2,
}

export function layerOf(bankRelativePath: string): Layer {
  const top = bankRelativePath.split('/')[0]
  if (!top || top.endsWith('.md')) return 'other'
  return BY_DIR[top] ?? 'other'
}
