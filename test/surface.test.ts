/**
 * A user-scoped MCP entry runs in every project on the machine, and the tool definitions sit in the
 * context of every request whether anything calls them or not — measured at ~6,600 tokens. There is
 * no per-project switch for a user-scoped server on the client side, so the server decides for
 * itself how much of a surface a project gets.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Bank } from '../src/bank.js'
import { init } from '../src/init.js'
import { OFF_MARKER, hasBank, surfaceFor } from '../src/surface.js'

let dir: string
const made: string[] = []

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memorybank-surface-'))
  made.push(dir)
})

afterAll(async () => {
  await Promise.all(made.map((d) => fs.rm(d, { recursive: true, force: true })))
})

const root = (): string => path.join(dir, 'memory_bank')

describe('a project with no bank', () => {
  it('is seed, not an error — never having had a bank is the normal state', async () => {
    expect(await surfaceFor(root())).toBe('seed')
  })

  it('is still seed when the directory exists but is empty', async () => {
    await fs.mkdir(root(), { recursive: true })
    expect(await surfaceFor(root())).toBe('seed')
  })

  it('is still seed when only an empty _inbox sits there', async () => {
    // The Stop hook can create _inbox/ before anything else exists. That is not a bank.
    await fs.mkdir(path.join(root(), '_inbox'), { recursive: true })
    expect(await surfaceFor(root())).toBe('seed')
  })
})

describe('a project with a bank', () => {
  beforeEach(async () => {
    const bank = new Bank(root())
    await init(bank, { name: 'Surface' })
  })

  it('gets the whole surface', async () => {
    expect(await surfaceFor(root())).toBe('full')
  })

  it('turns off when the marker sits beside the bank', async () => {
    await fs.writeFile(path.join(dir, OFF_MARKER), '', 'utf8')
    expect(await surfaceFor(root())).toBe('off')
  })

  it('is not turned off by a marker inside the bank — the project owns that decision', async () => {
    await fs.writeFile(path.join(root(), OFF_MARKER), '', 'utf8')
    expect(await surfaceFor(root())).toBe('full')
  })
})

describe('the marker wins over everything', () => {
  it('turns off a project that has no bank either', async () => {
    await fs.writeFile(path.join(dir, OFF_MARKER), '', 'utf8')
    expect(await surfaceFor(root())).toBe('off')
  })
})

describe('hasBank', () => {
  it('is false for a path that does not exist, rather than throwing', async () => {
    expect(await hasBank(path.join(dir, 'nowhere'))).toBe(false)
  })

  it('is true for a lone document with no directories', async () => {
    await fs.mkdir(root(), { recursive: true })
    await fs.writeFile(path.join(root(), 'README.md'), '# x\n', 'utf8')
    expect(await hasBank(root())).toBe(true)
  })

  it('ignores a stray non-markdown file', async () => {
    await fs.mkdir(root(), { recursive: true })
    await fs.writeFile(path.join(root(), '.DS_Store'), '', 'utf8')
    expect(await hasBank(root())).toBe(false)
  })

  it('accepts a relative path, since that is how a global entry is written', async () => {
    const bank = new Bank(root())
    await init(bank, { name: 'Relative' })
    const cwd = process.cwd()
    try {
      process.chdir(dir)
      expect(await surfaceFor('./memory_bank')).toBe('full')
    } finally {
      process.chdir(cwd)
    }
  })
})
