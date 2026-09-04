import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Bank } from './bank.js'

const run = promisify(execFile)

/**
 * A document and one of the code paths it claims to describe.
 *
 * Nothing here is inferred from content. The pairing is declared by hand in `anchors:`, and all the
 * server contributes is the two timestamps — which is the whole design: a drift detector that
 * guesses is a drift detector nobody trusts.
 */
export interface DriftPair {
  path: string
  title: string
  status: string
  /** The code path, exactly as the document declared it. */
  anchor: string
  /** Last commit that touched the document, ISO. Absent when it has never been committed. */
  docTouched?: string
  /** Last commit that touched the anchor, ISO. */
  codeTouched?: string
  /** Whole days the code has been ahead of the document. */
  aheadDays?: number
  /** The anchor names nothing on disk: the code moved or was deleted and the document did not notice. */
  missing?: boolean
}

export interface DriftResult {
  mode: 'git' | 'none'
  repo?: string
  thresholdDays: number
  /** Documents carrying at least one anchor. */
  anchored: number
  /** Documents carrying none — the field is opt-in, and a low number here is the real limit on this tool. */
  unanchored: number
  /** Code newer than the document that owns it, by more than the threshold. Widest gap first. */
  drifted: DriftPair[]
  /** Anchors pointing at a path that no longer exists. Always reported, threshold or not. */
  missing: DriftPair[]
  note?: string
}

const DEFAULT_THRESHOLD_DAYS = 90
const DAY = 86_400_000

/** Marks a date line in the log, so it cannot be confused with a file called `2026-09-05`. */
const STAMP = '@@'

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

/**
 * The newest commit date for each of the given paths, in one pass over the log.
 *
 * One `git log -1` per path would be simpler and is what this replaced; on a bank with fifty anchors
 * that is a hundred process spawns for a question asked at the top of a session.
 */
async function lastTouched(repo: string, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (paths.length === 0) return out

  const log = await git(repo, ['log', `--format=${STAMP}%cI`, '--name-only', '--', ...paths]).catch(() => '')

  let when = ''
  for (const line of log.split('\n')) {
    if (line.startsWith(STAMP)) {
      when = line.slice(STAMP.length).trim()
      continue
    }
    const file = line.trim()
    // The log walks newest first, so the first sighting of a path is the one that counts.
    if (file && when && !out.has(file)) out.set(file, when)
  }
  return out
}

/** The newest timestamp among the logged files that live at or under `anchor`. */
function newestUnder(touched: Map<string, string>, anchor: string): string | undefined {
  const exact = touched.get(anchor)
  if (exact) return exact
  const prefix = anchor.endsWith('/') ? anchor : `${anchor}/`
  let best: string | undefined
  for (const [file, when] of touched) {
    if (!file.startsWith(prefix)) continue
    if (!best || when > best) best = when
  }
  return best
}

/**
 * Which documents the code has moved on without.
 *
 * The failure this addresses is not that something went unwritten — validation already catches
 * that — but that what was written went quietly stale, which no rule inside the bank can see. So
 * this reports and never edits: a pair, two dates, and the gap between them.
 */
export async function drift(
  bank: Bank,
  opts: { thresholdDays?: number; scope?: string } = {},
): Promise<DriftResult> {
  const thresholdDays = Math.max(0, opts.thresholdDays ?? DEFAULT_THRESHOLD_DAYS)
  const scope = opts.scope?.replace(/^\/+|\/+$/g, '')

  const docs = bank.all().filter((doc) => !scope || doc.path === scope || doc.path.startsWith(`${scope}/`))
  const anchored = docs.filter((doc) => doc.anchors.length > 0)
  const base = {
    thresholdDays,
    anchored: anchored.length,
    unanchored: docs.length - anchored.length,
  }

  if (anchored.length === 0) {
    return {
      ...base,
      mode: 'none',
      drifted: [],
      missing: [],
      note:
        'No document in this scope declares `anchors:`. Add a list of repository-relative code paths ' +
        'to the frontmatter of the documents that describe code — that annotation is the only thing ' +
        'this tool reads, and without it there is nothing to compare.',
    }
  }

  let repo: string | null = null
  try {
    repo = (await git(bank.root, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    repo = null
  }
  if (!repo) {
    return {
      ...base,
      mode: 'none',
      drifted: [],
      missing: [],
      note:
        'This bank is not inside a git repository, so there are no commit dates to compare. ' +
        'Modification times would answer a different question: a file copied yesterday is not a file ' +
        'changed yesterday.',
    }
  }

  // git speaks in paths relative to the repository root; the bank speaks in its own. Resolve both
  // ends before subtracting, or every document looks like it sits outside the repository.
  const realRepo = await fs.realpath(repo).catch(() => repo)
  const realBank = await fs.realpath(bank.root).catch(() => bank.root)
  const bankPrefix = path.relative(realRepo, realBank).split(path.sep).join('/')
  const docInRepo = (rel: string): string => (bankPrefix ? `${bankPrefix}/${rel}` : rel)

  const anchorPaths = [...new Set(anchored.flatMap((doc) => doc.anchors))]
  const touched = await lastTouched(realRepo, [...anchorPaths, ...anchored.map((doc) => docInRepo(doc.path))])

  const drifted: DriftPair[] = []
  const missing: DriftPair[] = []

  for (const doc of anchored) {
    const docTouched = touched.get(docInRepo(doc.path))
    for (const anchor of doc.anchors) {
      const pair: DriftPair = {
        path: doc.path,
        title: doc.title,
        status: doc.status,
        anchor,
        ...(docTouched ? { docTouched } : {}),
      }

      const exists = await fs
        .access(path.join(realRepo, anchor))
        .then(() => true)
        .catch(() => false)
      if (!exists) {
        missing.push({ ...pair, missing: true })
        continue
      }

      const codeTouched = newestUnder(touched, anchor)
      if (!codeTouched) continue
      pair.codeTouched = codeTouched

      // A document that has never been committed cannot be behind anything yet.
      if (!docTouched) continue

      const gap = Date.parse(codeTouched) - Date.parse(docTouched)
      if (gap <= thresholdDays * DAY) continue
      drifted.push({ ...pair, aheadDays: Math.floor(gap / DAY) })
    }
  }

  drifted.sort((a, b) => (b.aheadDays ?? 0) - (a.aheadDays ?? 0) || a.path.localeCompare(b.path))
  missing.sort((a, b) => a.path.localeCompare(b.path) || a.anchor.localeCompare(b.anchor))

  return { ...base, mode: 'git', repo: realRepo, drifted, missing }
}
