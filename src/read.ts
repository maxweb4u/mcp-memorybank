import fs from 'node:fs/promises'
import { splitFrontmatter } from './parse.js'
import type { Bank } from './bank.js'

export interface ReadResult {
  path: string
  title: string
  frontmatter: Record<string, unknown>
  section?: string
  content: string
  bytes: number
  truncated: boolean
  availableSections: string[]
}

const MAX_BYTES = 400_000

/** Body of one level-two section: from its heading up to the next level-two heading. */
function sliceSection(body: string, wanted: string): { title: string; text: string } | null {
  const lines = body.split('\n')
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const target = norm(wanted)

  let start = -1
  let title = ''
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    if (start === -1) {
      if (norm(m[1]!) === target || norm(m[1]!).includes(target)) {
        start = i
        title = m[1]!
      }
    } else {
      return { title, text: lines.slice(start, i).join('\n').trimEnd() }
    }
  }
  if (start === -1) return null
  return { title, text: lines.slice(start).join('\n').trimEnd() }
}

export async function read(bank: Bank, docPath: string, section?: string): Promise<ReadResult> {
  const doc = bank.get(docPath)
  if (!doc) throw new Error(`Not a document of this bank: ${docPath}`)

  const raw = await fs.readFile(bank.abs(doc.path), 'utf8')
  const parsed = splitFrontmatter(raw)
  const available = doc.sections.map((s) => s.title)

  let content = parsed.body.trim()
  let sectionTitle: string | undefined

  if (section) {
    const found = sliceSection(parsed.body, section)
    if (!found) {
      throw new Error(
        `Section "${section}" not found in ${doc.path}. Available: ${available.join(' | ') || '(none)'}`,
      )
    }
    content = found.text
    sectionTitle = found.title
  }

  const truncated = Buffer.byteLength(content) > MAX_BYTES
  if (truncated) content = content.slice(0, MAX_BYTES)

  return {
    path: doc.path,
    title: doc.title,
    frontmatter: parsed.data,
    section: sectionTitle,
    content,
    bytes: Buffer.byteLength(content),
    truncated,
    availableSections: available,
  }
}

export interface ReadManyResult {
  documents: ReadResult[]
  /** Paths that could not be read, with the reason. A bad path does not sink the whole batch. */
  failed: { path: string; error: string }[]
  /** Documents the budget did not reach, with their sections, so the caller can ask for a part. */
  skipped: { path: string; title: string; bytes: number; availableSections: string[] }[]
  bytes: number
  budgetBytes: number
  /** Present when the caller asked for more than the ceiling allows. */
  note?: string
}

/**
 * How much document body one call may return, and a ceiling the caller cannot raise.
 *
 * Measured in the field on a five-path read: 55,705 bytes of markdown came back as 61,564 characters
 * of JSON — escaping newlines costs about a tenth, not the doubling an earlier estimate assumed — and
 * the caller persisted it to a file instead of returning it. A seven-path read of 91,073 characters
 * was refused outright, so the answer was a file path both times.
 *
 * The same session showed why a soft default is not enough: the agent passed `maxBytes: 200000` on
 * both calls and opted straight out of the budget it did not know it wanted. So the budget is a
 * ceiling now — `maxBytes` may lower it and never raise it — and a document that would overshoot is
 * named under `skipped` rather than read whole. The first document is always returned, so a bank
 * whose smallest document exceeds the budget still answers with something.
 */
const BATCH_BUDGET = 40_000

/**
 * Reads several documents in one call. Measured need, not symmetry: over two full working sessions
 * an agent called `bank_read` zero times and `cat` in a shell loop instead, because ten documents
 * were ten tool calls one way and one call the other. Section scoping — the thing that keeps large
 * documents out of the context window — lost on arithmetic before it was ever considered.
 */
export async function readMany(
  bank: Bank,
  requests: readonly (string | { path: string; section?: string })[],
  opts: { maxBytes?: number } = {},
): Promise<ReadManyResult> {
  const asked = opts.maxBytes ?? BATCH_BUDGET
  const budget = Math.min(asked, BATCH_BUDGET)
  const documents: ReadResult[] = []
  const failed: { path: string; error: string }[] = []
  const skipped: ReadManyResult['skipped'] = []
  let spent = 0

  for (const request of requests) {
    const { path: docPath, section } = typeof request === 'string' ? { path: request, section: undefined } : request
    const doc = bank.get(docPath)
    // Look ahead on the indexed size, so the budget bounds what comes back rather than what was
    // already over it. Sectioned requests read less than the whole file, so they are not held back.
    const overshoots = !section && doc ? spent + doc.bytes > budget : false
    if (documents.length > 0 && (spent >= budget || overshoots)) {
      skipped.push({
        path: docPath,
        title: doc?.title ?? '',
        bytes: doc?.bytes ?? 0,
        availableSections: doc?.sections.map((s) => s.title) ?? [],
      })
      continue
    }
    try {
      const result = await read(bank, docPath, section)
      spent += result.bytes
      documents.push(result)
    } catch (err) {
      failed.push({ path: docPath, error: err instanceof Error ? err.message : String(err) })
    }
  }
  const note =
    asked > BATCH_BUDGET
      ? `maxBytes ${asked} is above the ceiling of ${BATCH_BUDGET}, so ${BATCH_BUDGET} was used. ` +
        'A larger answer is returned to you as a file path rather than as text, which is worse than a ' +
        'short answer. Read the skipped documents by section.'
      : undefined
  return { documents, failed, skipped, bytes: spent, budgetBytes: budget, ...(note ? { note } : {}) }
}
