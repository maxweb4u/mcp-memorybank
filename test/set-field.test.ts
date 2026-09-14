import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Bank } from '../src/bank.js'
import { init } from '../src/init.js'
import { registerLine } from '../src/create.js'
import { setField } from '../src/update.js'

let root: string
let bank: Bank

/** Seeded by bank_init, and listed in its index under a summary that does not repeat the purpose. */
const SEEDED = 'product/context.md'

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-setfield-'))
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

const read = (p: string) => fs.readFile(bank.abs(p), 'utf8')

/** A document written by hand, for frontmatter shapes no template produces. */
async function handWritten(p: string, head: string, body = '# Hand Written\n\n## Notes\n\nText.\n'): Promise<void> {
  await fs.mkdir(path.dirname(bank.abs(p)), { recursive: true })
  await fs.writeFile(bank.abs(p), `---\n${head}\n---\n${body}`, 'utf8')
  await bank.refresh()
}

const BASE = 'doc_kind: engineering\ndoc_function: canonical\nstatus: draft'

describe('changing what a document says it is for', () => {
  it('sets purpose and leaves every other byte of the file as it was', async () => {
    const before = await read(SEEDED)
    const next = 'What the project solves, for whom, and the limits every other document inherits.'

    const result = await setField(bank, { path: SEEDED, field: 'purpose', value: next })

    expect(result).toMatchObject({ field: 'purpose', to: next, changed: true, line: `purpose: ${next}` })
    expect(result.from).toMatch(/^The problem the project solves/)
    const oldLine = before.split('\n').find((l) => l.startsWith('purpose:'))!
    expect(await read(SEEDED)).toBe(before.replace(oldLine, result.line))

    await bank.refresh()
    expect(bank.get(SEEDED)!.purpose).toBe(next)
    expect(bank.get(SEEDED)!.parseError).toBeUndefined()
  })

  it('keeps a single-quoted value single-quoted, doubling the apostrophe', async () => {
    await handWritten('engineering/quoted-single.md', `title: Single\n${BASE}\npurpose: 'Read before anything.'`)

    const result = await setField(bank, {
      path: 'engineering/quoted-single.md',
      field: 'purpose',
      value: "Read before the owner's release.",
    })

    expect(result.line).toBe("purpose: 'Read before the owner''s release.'")
    await bank.refresh()
    expect(bank.get('engineering/quoted-single.md')!.purpose).toBe("Read before the owner's release.")
  })

  it('keeps a double-quoted value double-quoted', async () => {
    await handWritten('engineering/quoted-double.md', `title: Double\n${BASE}\npurpose: "Read first."`)

    const result = await setField(bank, { path: 'engineering/quoted-double.md', field: 'purpose', value: 'Read "second".' })

    expect(result.line).toBe('purpose: "Read \\"second\\"."')
    await bank.refresh()
    expect(bank.get('engineering/quoted-double.md')!.purpose).toBe('Read "second".')
  })

  it('quotes a plain value that YAML would misread or refuse', async () => {
    await handWritten('engineering/plain.md', `title: Plain\n${BASE}\npurpose: Read first.`)

    const colon = await setField(bank, { path: 'engineering/plain.md', field: 'purpose', value: 'Read when: the build breaks' })
    expect(colon.line).toBe('purpose: "Read when: the build breaks"')

    await bank.refresh()
    const date = await setField(bank, { path: 'engineering/plain.md', field: 'reviewed_on', value: '2026-09-14' })
    expect(date.line).toBe('reviewed_on: "2026-09-14"')

    await bank.refresh()
    const doc = bank.get('engineering/plain.md')!
    expect(doc.parseError).toBeUndefined()
    expect(doc.purpose).toBe('Read when: the build breaks')
  })

  it('leaves a value that was a date a date', async () => {
    await handWritten('engineering/dated.md', `title: Dated\n${BASE}\npurpose: Read first.\nreviewed_on: 2026-09-01`)

    const result = await setField(bank, { path: 'engineering/dated.md', field: 'reviewed_on', value: '2026-09-14' })

    expect(result).toMatchObject({ from: '2026-09-01', line: 'reviewed_on: 2026-09-14' })
  })

  it('replaces a value folded over several lines with one line, and nothing after it', async () => {
    await handWritten(
      'engineering/folded.md',
      `title: Folded\n${BASE}\npurpose: >-\n  Read before touching\n  the parser.\naudience: humans_and_agents`,
    )

    await setField(bank, { path: 'engineering/folded.md', field: 'purpose', value: 'Read before touching the parser or its tests.' })

    const after = await read('engineering/folded.md')
    expect(after).toContain('purpose: Read before touching the parser or its tests.\naudience: humans_and_agents\n---')
    expect(after).not.toContain('  the parser.')
  })

  it('adds a field that is not there yet, just before the closing line', async () => {
    await handWritten('engineering/tracked.md', `title: Tracked\n${BASE}\npurpose: Read first.`)
    const value = [...bank.contract.deliveryStatuses][0]!

    const result = await setField(bank, { path: 'engineering/tracked.md', field: 'delivery_status', value })

    expect(result.from).toBeNull()
    expect(await read('engineering/tracked.md')).toContain(`purpose: Read first.\ndelivery_status: ${value}\n---`)
    await bank.refresh()
    expect(bank.get('engineering/tracked.md')!.deliveryStatus).toBe(value)
  })

  it('reports a value that is already set without touching the file', async () => {
    const before = await read('engineering/tracked.md')
    const value = bank.get('engineering/tracked.md')!.deliveryStatus!

    const result = await setField(bank, { path: 'engineering/tracked.md', field: 'delivery_status', value })

    expect(result.changed).toBe(false)
    expect(await read('engineering/tracked.md')).toBe(before)
  })
})

describe('what moves with the value', () => {
  const DOC = 'engineering/parser-limits.md'
  const PURPOSE = 'Read before changing how large files are parsed.'

  beforeAll(async () => {
    await handWritten(DOC, `title: Parser Limits\n${BASE}\npurpose: ${PURPOSE}`, '# Parser Limits\n\n## Notes\n\nText.\n')
    const indexPath = 'engineering/README.md'
    const indexRaw = await read(indexPath)
    await fs.writeFile(bank.abs(indexPath), registerLine(indexRaw, indexPath, DOC, 'Parser Limits', PURPOSE), 'utf8')
    await bank.refresh()
  })

  it('carries a new purpose into the index entry that repeated the old one', async () => {
    expect(bank.get(DOC)!.registeredIn).toContain('engineering/README.md')

    const result = await setField(bank, { path: DOC, field: 'purpose', value: 'Read before changing the size limits of the parser.' })

    expect(result.indexes).toEqual(['engineering/README.md'])
    const index = await read('engineering/README.md')
    expect(index).toContain('Read before changing the size limits of the parser.')
    expect(index).not.toContain(PURPOSE)
  })

  it('leaves a hand-written summary alone', async () => {
    const index = bank.get(SEEDED)!.registeredIn[0]!
    const before = await read(index)

    const result = await setField(bank, { path: SEEDED, field: 'purpose', value: 'Why the project exists, and for whom.' })

    expect(result.indexes).toEqual([])
    expect(await read(index)).toBe(before)
  })

  it('renames the H1 and the index link along with the title', async () => {
    const result = await setField(bank, { path: DOC, field: 'title', value: 'Parse Limits' })

    expect(result).toMatchObject({ heading: true, indexes: ['engineering/README.md'] })
    expect(await read(DOC)).toContain('\n# Parse Limits\n')
    expect(await read('engineering/README.md')).toMatch(/\[`?Parse Limits`?\]\(parser-limits\.md\)/)
  })

  it('writes nothing under dryRun, the index included', async () => {
    const doc = await read(DOC)
    const index = await read('engineering/README.md')

    const result = await setField(bank, { path: DOC, field: 'title', value: 'Something Else', dryRun: true })

    expect(result).toMatchObject({ changed: false, dryRun: true, heading: true })
    expect(await read(DOC)).toBe(doc)
    expect(await read('engineering/README.md')).toBe(index)
  })
})

describe('what it refuses', () => {
  it('sends status to the tool that runs its gates', async () => {
    await expect(setField(bank, { path: SEEDED, field: 'status', value: 'active' })).rejects.toThrow(/bank_set_status/)
  })

  it('refuses to change what a document was created as', async () => {
    await expect(setField(bank, { path: SEEDED, field: 'doc_kind', value: 'domain' })).rejects.toThrow(/re-creating/)
    await expect(setField(bank, { path: SEEDED, field: 'doc_function', value: 'index' })).rejects.toThrow(/re-creating/)
  })

  it('refuses the list fields that carry governance', async () => {
    await expect(setField(bank, { path: SEEDED, field: 'derived_from', value: '../dna/principles.md' })).rejects.toThrow(/is a list/)
    await expect(setField(bank, { path: SEEDED, field: 'canonical_for', value: 'x' })).rejects.toThrow(/releaseCanonical/)
  })

  it('refuses any key that holds a list, not only the known ones', async () => {
    await handWritten('engineering/tagged.md', `title: Tagged\n${BASE}\npurpose: Read first.\ntags:\n  - parser`)
    await expect(setField(bank, { path: 'engineering/tagged.md', field: 'tags', value: 'parser' })).rejects.toThrow(/list or a mapping/)
  })

  it('refuses an enum value the bank does not declare, and names the ones it does', async () => {
    const allowed = [...bank.contract.deliveryStatuses]
    await expect(setField(bank, { path: SEEDED, field: 'delivery_status', value: 'shipped' })).rejects.toThrow(
      new RegExp(`Allowed: ${allowed[0]}`),
    )
  })

  it('refuses a value that is empty or runs over lines, and a key that is not one', async () => {
    await expect(setField(bank, { path: SEEDED, field: 'purpose', value: '  ' })).rejects.toThrow(/empty/)
    await expect(setField(bank, { path: SEEDED, field: 'purpose', value: 'one\ntwo' })).rejects.toThrow(/one line/)
    await expect(setField(bank, { path: SEEDED, field: 'two words', value: 'x' })).rejects.toThrow(/not a frontmatter key/)
  })

  it('refuses a template and an unknown path', async () => {
    await handWritten('engineering/a-template.md', 'title: A Template\ndoc_kind: engineering\ndoc_function: template\npurpose: Shape.')
    await expect(setField(bank, { path: 'engineering/a-template.md', field: 'purpose', value: 'x' })).rejects.toThrow(/template/)
    await expect(setField(bank, { path: 'engineering/nowhere.md', field: 'purpose', value: 'x' })).rejects.toThrow(/Not a document/)
  })
})
