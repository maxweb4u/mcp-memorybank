import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Bank } from '../src/bank.js'
import { init } from '../src/init.js'
import { create, discard, promote } from '../src/create.js'
import { edit, updateSection } from '../src/update.js'
import { readMany } from '../src/read.js'
import { validate } from '../src/validate.js'
import { route } from '../src/route.js'

let root: string
let bank: Bank

/** The two documents bank_init seeds as drafts precisely so that they will be filled later. */
const PLACEHOLDER = 'product/context.md'

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-update-'))
  bank = new Bank(path.join(root, 'memory_bank'))
  await bank.refresh()
  await init(bank, { name: 'ebook_parser' })
}, 30_000)

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

beforeEach(async () => {
  await bank.refresh()
})

describe('filling what bank_init seeded', () => {
  it('writes one section and leaves the frontmatter byte for byte', async () => {
    const before = await fs.readFile(bank.abs(PLACEHOLDER), 'utf8')
    const head = before.slice(0, before.indexOf('\n---', 3))

    const result = await updateSection(bank, {
      path: PLACEHOLDER,
      section: 'Problem',
      content: 'FB2 parsers on Dart are effectively absent, and every EPUB package returns its own model.',
    })

    expect(result.updated).toBe(true)
    const after = await fs.readFile(bank.abs(PLACEHOLDER), 'utf8')
    expect(after.startsWith(head)).toBe(true)
    expect(after).toContain('FB2 parsers on Dart are effectively absent')
  })

  it('leaves the other sections of that document alone', async () => {
    const before = await fs.readFile(bank.abs(PLACEHOLDER), 'utf8')
    const others = before.split(/^## /m).slice(2)

    await updateSection(bank, { path: PLACEHOLDER, section: 'Problem', content: 'Rewritten again.' })

    const after = await fs.readFile(bank.abs(PLACEHOLDER), 'utf8')
    for (const section of others) {
      expect(after).toContain(section.split('\n')[0]!)
    }
    expect(after).toContain('Rewritten again.')
    expect(after).not.toContain('FB2 parsers on Dart are effectively absent')
  })

  it('appends without losing what was there', async () => {
    await updateSection(bank, { path: PLACEHOLDER, section: 'Problem', content: 'First line.' })
    await updateSection(bank, {
      path: PLACEHOLDER,
      section: 'Problem',
      content: 'Second line.',
      mode: 'append',
    })
    const after = await fs.readFile(bank.abs(PLACEHOLDER), 'utf8')
    expect(after).toContain('First line.')
    expect(after).toContain('Second line.')
  })

  it('keeps the bank valid after being filled', async () => {
    await bank.refresh()
    expect(await validate(bank)).toEqual([])
  })

  it('reports what would change without writing, under dryRun', async () => {
    const before = await fs.readFile(bank.abs(PLACEHOLDER), 'utf8')
    const result = await updateSection(bank, {
      path: PLACEHOLDER,
      section: 'Problem',
      content: 'Not landing.',
      dryRun: true,
    })
    expect(result.updated).toBe(false)
    expect(result.dryRun).toBe(true)
    expect(await fs.readFile(bank.abs(PLACEHOLDER), 'utf8')).toBe(before)
  })
})

describe('what it refuses', () => {
  it('refuses a section that does not exist, and names the ones that do', async () => {
    await expect(
      updateSection(bank, { path: PLACEHOLDER, section: 'Nonexistent', content: 'x' }),
    ).rejects.toThrow(/not found.*Available:/s)
  })

  it('refuses a path outside the bank', async () => {
    await expect(
      updateSection(bank, { path: 'nowhere/absent.md', section: 'Problem', content: 'x' }),
    ).rejects.toThrow(/Not a document of this bank/)
  })

  it('refuses a template', async () => {
    const template = bank.all().find((d) => d.docFunction === 'template')!
    await expect(
      updateSection(bank, { path: template.path, section: 'Purpose', content: 'x' }),
    ).rejects.toThrow(/is a template/)
  })

  it('amends a quarantined note rather than refusing it', async () => {
    // A draft under review is exactly what gets amended before the decision to keep it. Refusing
    // here sent a real session to a Python heredoc to rewrite the note it was reviewing.
    await create(bank, {
      docKind: 'engineering',
      path: 'note.md',
      title: 'A Capture',
      purpose: 'Something noticed in passing.',
      inbox: true,
      body: '## Detail\n\nSomething.',
    })
    await bank.refresh()
    const result = await updateSection(bank, {
      path: '_inbox/note.md',
      section: 'Detail',
      content: 'Checked against the source: it holds.',
      mode: 'append',
    })
    expect(result.updated).toBe(true)
    const raw = await fs.readFile(bank.abs('_inbox/note.md'), 'utf8')
    expect(raw).toContain('Something.')
    expect(raw).toContain('Checked against the source: it holds.')
  })

  it('refuses empty content rather than silently emptying a section', async () => {
    await expect(
      updateSection(bank, { path: PLACEHOLDER, section: 'Problem', content: '   ' }),
    ).rejects.toThrow(/empty/)
  })
})

describe('bodies at creation, and the quarantine staying out of navigation', () => {
  it('writes the body given to bank_create instead of leaving headings alone', async () => {
    const result = await create(bank, {
      docKind: 'domain',
      path: 'domain/model.md',
      title: 'Document Model',
      purpose: 'The model both formats converge on.',
      derivedFrom: ['../product/context.md'],
      body: '## The Model\n\nDocument, chapter, paragraph.',
    })
    expect(result.created).toBe(true)
    const written = await fs.readFile(bank.abs('domain/model.md'), 'utf8')
    expect(written).toContain('Document, chapter, paragraph.')
  })

  it('keeps a quarantined note out of bank_route entirely', async () => {
    await bank.refresh()
    const results = route(bank, 'a capture something noticed in passing', { limit: 10 })
    expect(results.map((r) => r.path)).not.toContain('_inbox/note.md')
  })
})

describe('dropping a note instead of keeping it', () => {
  const NOTE = '_inbox/transient.md'

  beforeEach(async () => {
    if (!bank.get(NOTE)) {
      await create(bank, {
        docKind: 'engineering',
        path: 'transient.md',
        title: 'Transient',
        purpose: 'Something true for an afternoon.',
        inbox: true,
        body: '## Detail\n\nGone by tomorrow.',
      })
      await bank.refresh()
    }
  })

  it('refuses without a reason, so nothing goes silently', async () => {
    await expect(discard(bank, { path: NOTE, reason: '  ' })).rejects.toThrow(/reason. is required/)
    expect(bank.get(NOTE)).toBeDefined()
  })

  it('refuses anything outside the quarantine', async () => {
    await expect(
      discard(bank, { path: PLACEHOLDER, reason: 'no longer needed' }),
    ).rejects.toThrow(/Only quarantined documents can be discarded/)
  })

  it('reports what would go, under dryRun, without deleting it', async () => {
    const result = await discard(bank, { path: NOTE, reason: 'superseded', dryRun: true })
    expect(result.discarded).toBe(false)
    expect(result.title).toBe('Transient')
    await bank.refresh()
    expect(bank.get(NOTE)).toBeDefined()
  })

  it('deletes the note and hands back what it said, with the reason', async () => {
    const result = await discard(bank, { path: NOTE, reason: 'folded into engineering/architecture.md' })
    expect(result.discarded).toBe(true)
    expect(result.purpose).toBe('Something true for an afternoon.')
    expect(result.reason).toBe('folded into engineering/architecture.md')
    await bank.refresh()
    expect(bank.get(NOTE)).toBeUndefined()
    expect(await validate(bank)).toEqual([])
  })
})

describe('edits smaller than a section', () => {
  const DOC = 'engineering/testing-policy.md'

  beforeEach(async () => {
    await updateSection(bank, {
      path: DOC,
      section: 'Current Coverage',
      content: ['| ID | Step | State |', '|---|---|---|', '| SC-10 | Parse EPUB | open |', '| SC-11 | Parse FB2 | open |'].join('\n'),
    })
    await bank.refresh()
  })

  it('replaces one row without resending the table', async () => {
    const result = await edit(bank, {
      path: DOC,
      find: '| SC-10 | Parse EPUB | open |',
      replace: '| SC-10 | Parse EPUB | done |',
    })
    expect(result.edited).toBe(true)
    const raw = await fs.readFile(bank.abs(DOC), 'utf8')
    expect(raw).toContain('| SC-10 | Parse EPUB | done |')
    expect(raw).toContain('| SC-11 | Parse FB2 | open |')
  })

  it('renames a heading, which is an ordinary edit', async () => {
    await edit(bank, { path: DOC, find: '## Current Coverage', replace: '## Coverage Today' })
    await bank.refresh()
    const raw = await fs.readFile(bank.abs(DOC), 'utf8')
    expect(raw).toContain('## Coverage Today')
    // and the renamed heading is what the section tools now address
    await expect(
      updateSection(bank, { path: DOC, section: 'Coverage Today', content: 'still here' }),
    ).resolves.toMatchObject({ section: 'Coverage Today' })
    await edit(bank, { path: DOC, find: '## Coverage Today', replace: '## Current Coverage' })
  })

  it('refuses an ambiguous match, with the count', async () => {
    await expect(edit(bank, { path: DOC, find: 'open', replace: 'done' })).rejects.toThrow(/Found 2 times/)
  })

  it('refuses a match that is not there, and says to read first', async () => {
    await expect(
      edit(bank, { path: DOC, find: '| SC-99 | Nothing | open |', replace: 'x' }),
    ).rejects.toThrow(/Not found.*match exactly/s)
  })

  it('narrows an ambiguous match with section', async () => {
    await updateSection(bank, { path: DOC, section: 'Simplify Review', content: 'open question' })
    await bank.refresh()
    const result = await edit(bank, {
      path: DOC,
      find: 'open question',
      replace: 'settled question',
      section: 'Simplify Review',
    })
    expect(result.section).toBe('Simplify Review')
  })

  it('cannot reach the frontmatter', async () => {
    await expect(edit(bank, { path: DOC, find: 'doc_kind:', replace: 'doc_kind_x:' })).rejects.toThrow(/Not found/)
  })

  it('leaves the file alone under dryRun', async () => {
    const before = await fs.readFile(bank.abs(DOC), 'utf8')
    await edit(bank, { path: DOC, find: '| SC-11 | Parse FB2 | open |', replace: '| SC-11 | Parse FB2 | done |', dryRun: true })
    expect(await fs.readFile(bank.abs(DOC), 'utf8')).toBe(before)
  })
})

describe('promotion carries its links with it', () => {
  it('rewrites a relative link that only made sense from _inbox/', async () => {
    await create(bank, {
      docKind: 'process',
      path: 'linked.md',
      title: 'A Linked Note',
      purpose: 'Points at a document one directory down.',
      inbox: true,
      body: 'See [the model](../domain/model.md) for the shape.',
    })
    await bank.refresh()

    const result = await promote(bank, {
      path: '_inbox/linked.md',
      to: 'domain/linked.md',
      docKind: 'domain',
      derivedFrom: ['model.md'],
    })
    expect(result.warnings.join(' ')).toMatch(/Link rewritten/)

    const raw = await fs.readFile(bank.abs('domain/linked.md'), 'utf8')
    expect(raw).toContain('](model.md)')
    expect(raw).not.toContain('](../domain/model.md)')
    await bank.refresh()
    expect(await validate(bank)).toEqual([])
  })
})

describe('the section index stops claiming to be empty', () => {
  it('drops the placeholder line when the first document is registered', async () => {
    const index = await fs.readFile(bank.abs('use-cases/README.md'), 'utf8')
    expect(index).toContain('Empty. A first document of this kind is registered here.')

    await create(bank, {
      docKind: 'use_case',
      path: 'use-cases/UC-001-open-a-book.md',
      title: 'UC-001: Open A Book',
      purpose: 'The caller hands over bytes and gets a document back.',
      derivedFrom: ['../domain/model.md'],
    })

    const after = await fs.readFile(bank.abs('use-cases/README.md'), 'utf8')
    expect(after).not.toContain('Empty. A first document of this kind is registered here.')
    expect(after).toContain('UC-001')
  })
})

describe('a batch read that does not overflow the caller', () => {
  beforeEach(async () => {
    for (const [path, section] of [['product/context.md', 'Problem'], ['engineering/testing-policy.md', 'Current Coverage']] as const) {
      await updateSection(bank, { path, section, content: 'x'.repeat(3000) })
    }
    await bank.refresh()
  })

  it('spends the budget in the order asked and names what it did not reach', async () => {
    const result = await readMany(
      bank,
      ['product/context.md', 'engineering/testing-policy.md', 'domain/model.md'],
      { maxBytes: 2000 },
    )
    expect(result.documents.map((d) => d.path)).toEqual(['product/context.md'])
    expect(result.skipped.map((s) => s.path)).toEqual(['engineering/testing-policy.md', 'domain/model.md'])
    expect(result.bytes).toBeGreaterThan(2000)
    expect(result.budgetBytes).toBe(2000)
  })

  it('hands back the sections of what it skipped, so the caller can ask for a part', async () => {
    const result = await readMany(bank, ['product/context.md', 'engineering/testing-policy.md'], { maxBytes: 1000 })
    const skipped = result.skipped[0]!
    expect(skipped.path).toBe('engineering/testing-policy.md')
    expect(skipped.availableSections).toContain('Current Coverage')
    expect(skipped.bytes).toBeGreaterThan(0)
  })

  it('still reports a bad path without sinking the batch', async () => {
    const result = await readMany(bank, ['domain/model.md', 'nowhere/absent.md'])
    expect(result.documents.map((d) => d.path)).toEqual(['domain/model.md'])
    expect(result.failed[0]!.path).toBe('nowhere/absent.md')
    expect(result.skipped).toEqual([])
  })
})
