/**
 * B-08. Layers were the one rule the server imposed instead of reading out of `dna/`, and the
 * failure was silent: a bank that renamed a section fell into layer `other`, lost its ranking
 * weight, and produced no finding, because validation never looked at layers.
 *
 * The tests below are mostly about the fallback. A bank that declares nothing must behave exactly
 * as it did before, because every existing bank is that bank.
 */
import { describe, expect, it } from 'vitest'
import { LAYER_WEIGHT, layerOf, layerWeights, parseLayerMap } from '../src/layer.js'

const table = (rows: string, heads = '| Directory | Layer | Weight |'): Map<string, string> =>
  new Map([['dna/governance.md', `# Governance\n\n${heads}\n|-|-|-|\n${rows}\n\nSome prose after.\n`]])

describe('a bank that declares nothing', () => {
  it('keeps the built-in map', () => {
    const none = parseLayerMap(new Map([['dna/principles.md', '# Principles\n\nNo tables here.\n']]))
    expect(none.byDir).toEqual({})
    expect(layerOf('use-cases/UC-1.md', none)).toBe('decision')
    expect(layerOf('features/FT-1/brief.md', none)).toBe('delivery')
    expect(layerWeights(none)).toBe(LAYER_WEIGHT)
  })

  it('is what an undefined map means too', () => {
    expect(layerOf('adr/ADR-1.md')).toBe('decision')
    expect(layerOf('nowhere/thing.md')).toBe('other')
    expect(layerWeights(undefined)).toBe(LAYER_WEIGHT)
  })
})

describe('a bank that renames a section', () => {
  it('keeps the layer by saying so', () => {
    const map = table('| `scenarios` | `decision` | 1.2 |')
    expect(layerOf('scenarios/UC-1.md', map ? parseLayerMap(map) : null)).toBe('decision')
  })

  it('leaves every directory it did not mention on the default', () => {
    const declared = parseLayerMap(table('| `scenarios` | `decision` | 1.2 |'))
    expect(layerOf('scenarios/x.md', declared)).toBe('decision')
    expect(layerOf('engineering/x.md', declared)).toBe('knowledge')
    expect(layerOf('features/x.md', declared)).toBe('delivery')
  })

  it('can move a built-in directory to another layer', () => {
    const declared = parseLayerMap(table('| `ops` | `delivery` | 0.6 |'))
    expect(layerOf('ops/runbook.md', declared)).toBe('delivery')
  })
})

describe('weights', () => {
  it('are overlaid on the defaults, not replaced by them', () => {
    const declared = parseLayerMap(table('| `product` | `knowledge` | 2.5 |'))
    const w = layerWeights(declared)
    expect(w.knowledge).toBe(2.5)
    expect(w.delivery).toBe(LAYER_WEIGHT.delivery)
    expect(w.inbox).toBe(LAYER_WEIGHT.inbox)
  })

  it('are optional — a table without the column still assigns layers', () => {
    const declared = parseLayerMap(table('| `scenarios` | `decision` |', '| Directory | Layer |'))
    expect(declared.byDir['scenarios']).toBe('decision')
    expect(declared.weight).toEqual({})
  })

  it('ignore a value that is not a number', () => {
    const declared = parseLayerMap(table('| `product` | `knowledge` | heavy |'))
    expect(declared.byDir['product']).toBe('knowledge')
    expect(declared.weight.knowledge).toBeUndefined()
  })
})

describe('a table the bank got wrong', () => {
  it('collects a layer that does not exist instead of accepting it', () => {
    const declared = parseLayerMap(table('| `scenarios` | `important` | 2.0 |'))
    expect(declared.byDir['scenarios']).toBeUndefined()
    expect(declared.unknown).toEqual([{ dir: 'scenarios', layer: 'important', source: 'dna/governance.md' }])
    expect(layerOf('scenarios/x.md', declared)).toBe('other')
  })

  it('does not let one bad row void the rest of the table', () => {
    const declared = parseLayerMap(
      table('| `scenarios` | `important` |\n| `guides` | `knowledge` |', '| Directory | Layer |'),
    )
    expect(declared.unknown).toHaveLength(1)
    expect(declared.byDir['guides']).toBe('knowledge')
  })
})

describe('finding the table at all', () => {
  it('ignores tables that are not about layers', () => {
    const declared = parseLayerMap(
      new Map([
        [
          'dna/governance.md',
          '| Field | Values | Purpose |\n|-|-|-|\n| `doc_kind` | `adr` | Document type or artifact layer |\n',
        ],
      ]),
    )
    expect(declared.byDir).toEqual({})
    expect(declared.unknown).toEqual([])
  })

  it('accepts a separator written as |-|-| or as |---|---|', () => {
    const short = parseLayerMap(table('| `guides` | `knowledge` |', '| Directory | Layer |'))
    const long = parseLayerMap(
      new Map([['dna/governance.md', '| Directory | Layer |\n|---|---|\n| `guides` | `knowledge` |\n']]),
    )
    expect(short.byDir['guides']).toBe('knowledge')
    expect(long.byDir['guides']).toBe('knowledge')
  })

  it('reads only dna/, so a section index cannot redefine the bank', () => {
    const declared = parseLayerMap(
      new Map([['engineering/README.md', '| Directory | Layer |\n|-|-|\n| `engineering` | `dna` |\n']]),
    )
    expect(declared.byDir).toEqual({})
  })

  it('names the documents it read rows from', () => {
    const declared = parseLayerMap(table('| `guides` | `knowledge` |', '| Directory | Layer |'))
    expect(declared.source).toEqual(['dna/governance.md'])
  })
})

describe('the starter set', () => {
  it('declares the built-in map, so a seeded bank is explicit about it', async () => {
    const fs = await import('node:fs/promises')
    const raw = await fs.readFile(new URL('../starter/dna/governance.md', import.meta.url), 'utf8')
    const declared = parseLayerMap(new Map([['dna/governance.md', raw]]))

    expect(declared.unknown).toEqual([])
    expect(Object.keys(declared.byDir).length).toBeGreaterThanOrEqual(14)
    for (const [dir, layer] of Object.entries(declared.byDir)) {
      expect(layerOf(`${dir}/x.md`, null), `${dir} should keep its built-in layer`).toBe(layer)
    }
    expect(layerWeights(declared)).toEqual(LAYER_WEIGHT)
  })
})
