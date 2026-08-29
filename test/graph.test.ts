import { beforeAll, describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bank } from '../src/bank.js'
import { graph } from '../src/graph.js'

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture-bank')
let bank: Bank

beforeAll(async () => {
  bank = new Bank(FIXTURE)
  await bank.refresh()
})

const paths = (result: ReturnType<typeof graph>) =>
  result.nodes.filter((n) => n.depth > 0).map((n) => n.path)

describe('down — the blast radius', () => {
  it('returns the documents that lean on this one', () => {
    const down = graph(bank, 'domain/rules.md', { direction: 'down', depth: 1 })
    expect(paths(down)).toEqual(['engineering/architecture.md', 'features/FT-001/brief.md'])
  })

  it('reaches the second hop and labels its depth', () => {
    const down = graph(bank, 'domain/rules.md', { direction: 'down', depth: 2 })
    const adr = down.nodes.find((n) => n.path === 'adr/ADR-001-queue-choice.md')
    expect(adr?.depth).toBe(2) // rules -> architecture -> adr
  })

  it('counts the blast radius by layer', () => {
    const down = graph(bank, 'domain/rules.md', { direction: 'down', depth: 2 })
    expect(down.byLayer).toMatchObject({ knowledge: 1, delivery: 1, decision: 1 })
  })
})

describe('up — what it is built on', () => {
  it('follows derived_from', () => {
    const up = graph(bank, 'features/FT-001/brief.md', { direction: 'up', depth: 1 })
    expect(paths(up)).toEqual(['adr/ADR-001-queue-choice.md', 'domain/rules.md'])
  })

  it('carries fit through the edge', () => {
    const up = graph(bank, 'features/FT-001/brief.md', { direction: 'up', depth: 1 })
    const edge = up.edges.find((e) => e.to === 'adr/ADR-001-queue-choice.md')
    expect(edge?.fit).toContain('queue topology')
  })

  it('reports a reference outside the bank separately from a broken one', () => {
    const up = graph(bank, 'features/FT-001/brief.md', { direction: 'up', depth: 1 })
    expect(up.external.map((e) => e.raw)).toEqual(['../../../outside-bank/upstream.md'])
    expect(up.broken).toEqual([])

    const arch = graph(bank, 'engineering/architecture.md', { direction: 'up', depth: 1 })
    expect(arch.broken.map((e) => e.raw)).toEqual(['../missing/nowhere.md'])
  })
})

describe('traversal safety', () => {
  it('walks both directions in one call', () => {
    const both = graph(bank, 'domain/rules.md', { direction: 'both', depth: 1 })
    const vias = new Set(both.nodes.filter((n) => n.depth > 0).map((n) => n.via))
    expect(vias).toEqual(new Set(['up', 'down']))
  })

  it('stops at the node cap and says so', () => {
    const capped = graph(bank, 'dna/principles.md', { direction: 'down', depth: 4, limit: 3 })
    expect(capped.nodes).toHaveLength(3)
    expect(capped.truncated).toBe(true)
  })

  it('terminates on a deep walk of a bank that contains cycles', () => {
    const deep = graph(bank, 'dna/principles.md', { direction: 'both', depth: 6, limit: 200 })
    expect(deep.truncated).toBe(false)
    expect(deep.nodes.length).toBeLessThanOrEqual(bank.docs.size)
  })

  it('refuses a path that is not in the bank', () => {
    expect(() => graph(bank, 'nope.md')).toThrow(/Not a document of this bank/)
  })

  it('defaults to down at depth 2', () => {
    const d = graph(bank, 'domain/rules.md')
    expect(d.direction).toBe('down')
    expect(d.depth).toBe(2)
  })
})
