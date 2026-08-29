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
