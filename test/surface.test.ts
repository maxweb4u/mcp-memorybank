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
import { OFF_MARKER, hasBank, isUnder, surfaceFor } from '../src/surface.js'

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

describe('paths switched off from the client config', () => {
  beforeEach(async () => {
    const bank = new Bank(root())
    await init(bank, { name: 'Off By Path' })
  })

  it('turns off a bank named exactly', async () => {
    expect(await surfaceFor(root(), [dir])).toBe('off')
  })

  it('turns off a bank nested any number of levels below', async () => {
    // The case this exists for: one commercial project holding three banks at different depths.
    const deep = path.join(dir, 'backend', 'service', 'memory_bank')
    await init(new Bank(deep), { name: 'Deep' })
    expect(await surfaceFor(deep, [dir])).toBe('off')
  })

  it('leaves a sibling whose name merely starts the same alone', async () => {
    expect(await surfaceFor(root(), [`${dir}X`])).toBe('full')
  })

  it('accepts several paths and matches any of them', async () => {
    expect(await surfaceFor(root(), ['/nowhere', dir])).toBe('off')
  })

  it('changes nothing when none of them match', async () => {
    expect(await surfaceFor(root(), ['/nowhere', '/also-nowhere'])).toBe('full')
  })

  it('applies to a project with no bank as well', async () => {
    const empty = path.join(dir, 'fresh', 'memory_bank')
    expect(await surfaceFor(empty, [dir])).toBe('off')
  })

  it('writes nothing into the project it switches off', async () => {
    const before = (await fs.readdir(dir)).sort()
    await surfaceFor(root(), [dir])
    expect((await fs.readdir(dir)).sort()).toEqual(before)
  })
})

describe('isUnder', () => {
  it('matches a directory against itself', () => {
    expect(isUnder('/a/b', '/a/b')).toBe(true)
  })

  it('matches on whole segments only', () => {
    expect(isUnder('/a/bc', '/a/b')).toBe(false)
    expect(isUnder('/a/b/c', '/a/b')).toBe(true)
  })

  it('normalises before comparing, so a relative path still matches', () => {
    expect(isUnder('/a/b/../b/c', '/a/b')).toBe(true)
  })

  it('tolerates a trailing separator on the parent', () => {
    expect(isUnder('/a/b/c', '/a/b/')).toBe(true)
  })
})
