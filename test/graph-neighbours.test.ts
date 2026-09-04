/**
 * Edges that leave the bank. In a monorepo they are not exotic: `readtolearn` has three banks and
 * fifteen edges between them, six of which point at the ADRs that decide what the server is. Until
 * B-06 the graph listed those edges as bare strings, so "what else must I touch" stopped exactly
 * where the interesting part started.
 *
 * The rule being tested is a narrow one: read the target's header, one hop, and nothing else. No
 * indexing, no validation, no walking the neighbour's own edges.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Bank } from '../src/bank.js'
import { init } from '../src/init.js'
import { graph, resolveNeighbours } from '../src/graph.js'

let workspace: string
let bank: Bank

const write = async (rel: string, body: string): Promise<void> => {
  const full = path.join(workspace, rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, body, 'utf8')
}

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-neighbours-'))

  // The bank under test, in one repository of the workspace.
  bank = new Bank(path.join(workspace, 'backend', 'memory_bank'))
  await init(bank, { name: 'Backend' })

  // The neighbouring bank, in a sibling repository. Only its headers are ever read.
  await write(
    'frontend/memory_bank/adr/ADR-009-one-server.md',
    [
      '---',
      'title: "ADR-009 — one server, not three"',
      'doc_kind: adr',
      'status: active',
      'purpose: "Why the API is served by a single process."',
      'canonical_for:',
      '  - server topology',
      '  - deployment target',
      '---',
      '',
      '# ADR-009',
    ].join('\n'),
  )

  await write(
    'backend/memory_bank/engineering/api-contract.md',
    [
      '---',
      'title: "API contract"',
      'doc_kind: reference',
      'doc_function: canonical',
      'status: active',
      'purpose: "The shape of every endpoint."',
      'derived_from:',
      '  - ../../../frontend/memory_bank/adr/ADR-009-one-server.md',
      '  - ../../../frontend/memory_bank/adr/ADR-404-never-written.md',
      '---',
      '',
      '# API contract',
      '',
      'Registered from the section index.',
    ].join('\n'),
  )

  await bank.refresh()
})

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true })
})

describe('external edges, resolved one hop', () => {
  it('still lists them as external — the boundary does not move', () => {
    const up = graph(bank, 'engineering/api-contract.md', { direction: 'up', depth: 1 })
    expect(up.external).toHaveLength(2)
    expect(up.nodes.filter((n) => n.depth > 0)).toHaveLength(0)
  })

  it('reads the neighbour’s header, including what it owns', async () => {
    const up = graph(bank, 'engineering/api-contract.md', { direction: 'up', depth: 1 })
    const found = await resolveNeighbours(bank, up.external)

    const adr = found.find((n) => n.raw.includes('ADR-009'))!
    expect(adr.title).toBe('ADR-009 — one server, not three')
    expect(adr.docKind).toBe('adr')
    expect(adr.status).toBe('active')
    expect(adr.canonicalFor).toEqual(['server topology', 'deployment target'])
    expect(adr.from).toBe('engineering/api-contract.md')
    expect(adr.unreadable).toBeUndefined()
  })

  it('separates a broken edge from a merely external one', async () => {
    const up = graph(bank, 'engineering/api-contract.md', { direction: 'up', depth: 1 })
    const found = await resolveNeighbours(bank, up.external)

    const missing = found.find((n) => n.raw.includes('ADR-404'))!
    expect(missing.unreadable).toMatch(/no such file/)
    expect(missing.title).toBeUndefined()
  })

  it('does not walk the neighbour’s own edges', async () => {
    await write(
      'frontend/memory_bank/dna/principles.md',
      ['---', 'title: "Principles"', 'status: active', '---', '', '# Principles'].join('\n'),
    )
    await write(
      'frontend/memory_bank/adr/ADR-009-one-server.md',
      [
        '---',
        'title: "ADR-009 — one server, not three"',
        'doc_kind: adr',
        'status: active',
        'derived_from:',
        '  - ../dna/principles.md',
        '---',
        '',
        '# ADR-009',
      ].join('\n'),
    )

    const up = graph(bank, 'engineering/api-contract.md', { direction: 'up', depth: 3 })
    const found = await resolveNeighbours(bank, up.external)
    expect(found).toHaveLength(2)
    expect(found.some((n) => n.raw.includes('principles'))).toBe(false)
  })

  it('costs nothing when the bank has no external edges', async () => {
    expect(await resolveNeighbours(bank, [])).toEqual([])
  })

  it('refuses to read outside the levels above the bank it is allowed to reach', async () => {
    const far = await resolveNeighbours(bank, [
      { from: 'engineering/api-contract.md', raw: '../../../../../../../../etc/hosts.md' },
    ])
    expect(far[0]!.unreadable).toMatch(/outside/)
    expect(far[0]!.title).toBeUndefined()
  })

  it('says so when the edge points at something that is not markdown', async () => {
    const odd = await resolveNeighbours(bank, [
      { from: 'engineering/api-contract.md', raw: '../../../frontend/package.json' },
    ])
    expect(odd[0]!.unreadable).toBe('not a markdown file')
  })
})
