import type { Layer } from './types.js'

export const LAYERS: readonly Layer[] = [
  'dna',
  'knowledge',
  'decision',
  'delivery',
  'flow',
  'inbox',
  'other',
] as const

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
  use_cases: 'decision',
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

/**
 * What a bank says about its own directories, when it says anything.
 *
 * Every other rule the validator applies is read out of `dna/` — the enums, whether `derived_from`
 * is required, whether cycles are forbidden. Layers were the exception: a table compiled into the
 * server and imposed on every bank. A bank that called a section `scenarios` instead of `use-cases`
 * dropped to layer `other`, lost its ranking weight, and got no finding, because validation does
 * not look at layers at all. This closes that hole.
 */
export interface LayerMap {
  /** Directory name -> layer, overlaid on the built-in table. */
  byDir: Record<string, Layer>
  /** Layer -> ranking weight, overlaid on the built-in weights. */
  weight: Partial<Record<Layer, number>>
  /** Rows naming a layer that does not exist, kept so validation can report them. */
  unknown: { dir: string; layer: string; source: string }[]
  /** Which `dna/` documents contributed rows. */
  source: string[]
}

export const EMPTY_LAYER_MAP: LayerMap = { byDir: {}, weight: {}, unknown: [], source: [] }

const KNOWN = new Set<string>(LAYERS)

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

const BARE = (s: string): string => s.replace(/`/g, '').trim()

/**
 * Reads the layer table out of `dna/`, in the same shape the contract tables already use:
 *
 * ```
 * | Directory | Layer | Weight |
 * |---|---|---|
 * | `scenarios` | `decision` | 1.2 |
 * ```
 *
 * A bank that declares nothing gets the built-in map, which is what every existing bank relies on.
 */
export function parseLayerMap(docs: Map<string, string>): LayerMap {
  const map: LayerMap = { byDir: {}, weight: {}, unknown: [], source: [] }

  for (const [docPath, raw] of docs) {
    if (!docPath.startsWith('dna/')) continue

    let inTable = false
    let dirCol = -1
    let layerCol = -1
    let weightCol = -1
    let contributed = false

    for (const line of raw.split('\n')) {
      if (!line.trim().startsWith('|')) {
        inTable = false
        continue
      }
      const cs = cells(line)

      if (!inTable) {
        const heads = cs.map((c) => BARE(c).toLowerCase())
        dirCol = heads.findIndex((h) => h === 'directory' || h === 'section')
        layerCol = heads.findIndex((h) => h === 'layer')
        if (dirCol === -1 || layerCol === -1) continue
        weightCol = heads.findIndex((h) => h === 'weight')
        inTable = true
        continue
      }

      // The separator row, written as `|---|---|` or as `|-|-|`.
      if (cs.every((c) => /^:?-+:?$/.test(c))) continue

      const dir = BARE(cs[dirCol] ?? '').replace(/^\/+|\/+$/g, '')
      const layer = BARE(cs[layerCol] ?? '').toLowerCase()
      if (!dir || !layer) continue

      if (!KNOWN.has(layer)) {
        map.unknown.push({ dir, layer, source: docPath })
        continue
      }
      map.byDir[dir] = layer as Layer
      contributed = true

      if (weightCol !== -1) {
        const parsed = Number.parseFloat(BARE(cs[weightCol] ?? ''))
        if (Number.isFinite(parsed) && parsed >= 0) map.weight[layer as Layer] = parsed
      }
    }

    if (contributed || map.unknown.some((u) => u.source === docPath)) map.source.push(docPath)
  }

  return map
}

export function layerOf(bankRelativePath: string, declared?: LayerMap | null): Layer {
  const top = bankRelativePath.split('/')[0]
  if (!top || top.endsWith('.md')) return 'other'
  return declared?.byDir[top] ?? BY_DIR[top] ?? 'other'
}

/** Ranking weights, with anything the bank declared overlaid on the defaults. */
export function layerWeights(declared?: LayerMap | null): Record<Layer, number> {
  if (!declared || Object.keys(declared.weight).length === 0) return LAYER_WEIGHT
  return { ...LAYER_WEIGHT, ...declared.weight }
}
