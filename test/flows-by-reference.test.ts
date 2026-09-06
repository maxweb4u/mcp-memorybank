/**
 * B-10. `flows/` was 208 KB copied verbatim into every bank and then quietly forked. The item as
 * written said to point at all of it; the first full test run said otherwise, and the line ended up
 * inside `flows/`:
 *
 *   - the four prose flows (68 KB) are copied — people read them, and `bank_route` answers with them
 *   - `flows/templates/` (140 KB, 24 files) is pointed at — nobody reads a template as prose,
 *     routing skips them by construction, and four measured banks had not customised one
 *
 * Everything below is about the second half behaving as if the files were there.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Bank } from '../src/bank.js'
import { init, materializeFlows, shippedTemplateNames } from '../src/init.js'
import { create, templateSource } from '../src/create.js'
import { route } from '../src/route.js'
import { validate } from '../src/validate.js'

let dir: string
let bank: Bank
const made: string[] = []

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-flows-'))
  made.push(dir)
  bank = new Bank(path.join(dir, 'memory_bank'))
  await init(bank, { name: 'Flows' })
  await bank.refresh()
})

afterAll(async () => {
  await Promise.all(made.map((d) => fs.rm(d, { recursive: true, force: true })))
})

describe('what a seeded bank carries', () => {
  it('copies the prose flows and points at the templates', () => {
    expect(bank.get('flows/feature-flow.md')).toBeDefined()
    expect(bank.get('flows/epic-flow.md')).toBeDefined()
    expect(bank.get('flows/workflows.md')).toBeDefined()

    expect(bank.get('flows/templates/README.md')).toBeDefined()
    expect(bank.all().filter((d) => d.path.startsWith('flows/templates/'))).toHaveLength(1)
  })

  it('is a quarter of the size it used to be', () => {
    // 50 files before B-09 and B-10; 24 after.
    expect(bank.all().length).toBe(24)
  })

  it('still validates clean — the pointer is a governed document, not a stub', async () => {
    expect(await validate(bank)).toEqual([])
  })

  it('still answers a question about its own procedure', () => {
    // The cost that narrowed this item: with the prose gone too, routing had nothing to return.
    expect(route(bank, 'how a feature package moves through its gates', { limit: 3 })[0]!.path).toBe(
      'flows/feature-flow.md',
    )
  })
})

describe('templates the bank does not hold', () => {
  it('are found and instantiated as if it did', async () => {
    const result = await create(bank, {
      path: 'adr/ADR-20260906T120000Z-a-decision.md',
      docKind: 'adr',
      title: 'A Decision',
      purpose: 'Recorded through a template the bank does not carry.',
      derivedFrom: ['../dna/principles.md'],
    })
    expect(result.template).toBe('flows/templates/adr/ADR-ID.md')
    expect(bank.raw(result.path)).toContain('decision_status')
  })

  it('are reported as coming from the server', async () => {
    const found = await templateSource(bank, 'adr', 'adr/ADR-x.md')
    expect(found?.fromServer).toBe(true)
    expect(found?.path).toBe('flows/templates/adr/ADR-ID.md')
  })

  it('resolve a kind whose directory is named differently', async () => {
    const found = await templateSource(bank, 'use_case', 'use-cases/UC-001.md')
    expect(found?.path).toBe('flows/templates/use-case/UC-XXX.md')
  })

  it('come back empty for a kind that has none, rather than guessing', async () => {
    expect(await templateSource(bank, 'domain', 'domain/model.md')).toBeNull()
  })
})

describe('taking ownership', () => {
  it('copies the templates in and the bank then owns them', async () => {
    const result = await materializeFlows(bank)
    expect(result.files.length).toBeGreaterThan(20)
    expect(bank.get('flows/templates/adr/ADR-ID.md')).toBeDefined()
    expect(await validate(bank)).toEqual([])
  })

  it('makes the bank’s own copy win over the shipped one', async () => {
    await materializeFlows(bank)
    const own = bank.abs('flows/templates/adr/ADR-ID.md')
    await fs.writeFile(own, `${await fs.readFile(own, 'utf8')}\n## Locally Added Section\n`, 'utf8')
    await bank.refresh()

    const found = await templateSource(bank, 'adr', 'adr/ADR-x.md')
    expect(found?.fromServer).toBe(false)
    expect(found?.raw).toContain('Locally Added Section')
  })

  it('refuses to overwrite templates the bank customised', async () => {
    await materializeFlows(bank)
    await expect(materializeFlows(bank)).rejects.toThrow(/already holds/)
  })

  it('overwrites them when told to, and says how many', async () => {
    await materializeFlows(bank)
    const again = await materializeFlows(bank, { force: true })
    expect(again.warnings.join(' ')).toMatch(/Overwrote \d+ documents/)
  })

  it('leaves the prose flows alone — they were never the problem', async () => {
    const before = bank.raw('flows/feature-flow.md')
    await materializeFlows(bank)
    expect(bank.raw('flows/feature-flow.md')).toBe(before)
  })
})

describe('the rule that knew template names by finding them', () => {
  it('still knows them when the bank holds none', async () => {
    const names = await shippedTemplateNames()
    expect(names.has('design.md')).toBe(true)
    expect(names.has('brief.md')).toBe(true)

    // `feature-flow.md` says a fact is recorded in `design.md`. That is prose about package shape,
    // and unresolved-rule-reference has always excused it — by finding a template of that name in
    // the bank. With the templates pointed at, the evidence had to come from the server instead.
    const findings = await validate(bank, { rule: 'unresolved-rule-reference' })
    expect(findings).toEqual([])
  })
})
