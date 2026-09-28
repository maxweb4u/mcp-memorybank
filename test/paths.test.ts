import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Bank } from '../src/bank.js'
import { init } from '../src/init.js'
import { create, discard } from '../src/create.js'
import { read } from '../src/read.js'
import { edit } from '../src/update.js'

let root: string
let bank: Bank

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-paths-'))
  bank = new Bank(path.join(root, 'memory_bank'))
  await bank.refresh()
  await init(bank, { name: 'paths' })
}, 30_000)

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

beforeEach(async () => {
  await bank.refresh()
})

describe('a path given the way an agent sees it from the repository', () => {
  it('reads a document addressed as memory_bank/…', async () => {
    const result = await read(bank, 'memory_bank/product/context.md')
    expect(result.path).toBe('product/context.md')
  })

  it('reads a document addressed by its absolute path', async () => {
    const result = await read(bank, path.join(bank.root, 'product', 'context.md'))
    expect(result.path).toBe('product/context.md')
  })

  it('still refuses an absolute path outside the bank', async () => {
    await expect(read(bank, path.join(root, 'elsewhere.md'))).rejects.toThrow(/Not a document/)
  })

  it('edits through the same form', async () => {
    const result = await edit(bank, {
      path: 'memory_bank/product/context.md',
      find: '# Product Context',
      replace: '# Product Context',
      dryRun: true,
    }).catch((e: Error) => e)
    // identical find and replace is refused on its own merits, which proves the document was found
    expect(String(result)).toMatch(/identical/)
  })

  it('creates at the bank path, not in a nested memory_bank/', async () => {
    const result = await create(bank, {
      docKind: 'adr',
      path: 'memory_bank/adr/ADR-010-paths.md',
      title: 'ADR-010: Paths',
      purpose: 'Records how paths given from the repository root are read.',
      derivedFrom: ['../product/context.md'],
    })

    expect(result.path).toBe('adr/ADR-010-paths.md')
    await expect(fs.access(path.join(bank.root, 'adr', 'ADR-010-paths.md'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(bank.root, 'memory_bank'))).rejects.toThrow()
  })

  it('discards a quarantined note addressed as memory_bank/_inbox/…', async () => {
    const note = await create(bank, {
      docKind: 'engineering',
      path: 'paths-note.md',
      title: 'Paths Note',
      purpose: 'Read never: a note made to be dropped.',
      inbox: true,
    })
    await bank.refresh()

    const result = await discard(bank, { path: `memory_bank/${note.path}`, reason: 'made for the test' })

    expect(result.path).toBe(note.path)
    await expect(fs.access(bank.abs(note.path))).rejects.toThrow()
  })
})

describe('a bank that really holds a directory of its own name', () => {
  it('keeps the prefix, because it names a real place', async () => {
    const inner = path.join(bank.root, 'memory_bank')
    await fs.mkdir(inner, { recursive: true })
    await fs.writeFile(path.join(inner, 'inner.md'), '---\ntitle: Inner\npurpose: Read never.\n---\n# Inner\n', 'utf8')
    await bank.refresh()

    try {
      expect(bank.get('memory_bank/inner.md')?.path).toBe('memory_bank/inner.md')
      expect(bank.relative('memory_bank/product/context.md')).toBe('memory_bank/product/context.md')
    } finally {
      await fs.rm(inner, { recursive: true, force: true })
      await bank.refresh()
    }
  })
})
