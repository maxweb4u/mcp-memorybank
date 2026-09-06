import fs from 'node:fs/promises'
import path from 'node:path'
import type { BankDoc, Contract, IndexLink } from './types.js'
import { extractLinks, parseDoc } from './parse.js'
import { parseContract } from './contract.js'
import { EMPTY_LAYER_MAP, type LayerMap, layerOf, parseLayerMap } from './layer.js'
import { parseVocabulary, setLocalVocabulary } from './lang.js'

const SKIP_DIR = new Set(['node_modules', '.git', 'dist', '.obsidian'])

async function walk(root: string): Promise<string[]> {
  const out: string[] = []
  async function visit(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIR.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await visit(full)
      else if (e.isFile() && e.name.endsWith('.md')) out.push(full)
    }
  }
  await visit(root)
  return out
}

export interface RefreshStats {
  added: number
  changed: number
  removed: number
  durationMs: number
}

export class Bank {
  readonly root: string
  docs = new Map<string, BankDoc>()
  /** Full file text, kept so search, validation and index parsing never re-read the disk. */
  raws = new Map<string, string>()
  contract: Contract = parseContract(new Map())
  /** What the bank says about its own directories. Empty when it says nothing. */
  layers: LayerMap = EMPTY_LAYER_MAP
  /** path -> documents that declare it in `derived_from`. */
  incoming = new Map<string, string[]>()
  /** `canonical_for` key -> owning document paths. */
  ownerByKey = new Map<string, string[]>()
  /** Every markdown link found inside index documents. */
  indexLinks: IndexLink[] = []
  lastRefresh = 0
  /** How many terms `dna/vocabulary.md` contributed; 0 when the bank has no such file. */
  localVocabulary = 0

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  abs(relative: string): string {
    return path.join(this.root, relative)
  }

  /**
   * Re-reads only files whose mtime moved. On a few hundred documents a full stat sweep
   * costs single-digit milliseconds, which is why no filesystem watcher is needed.
   */
  async refresh(): Promise<RefreshStats> {
    const started = Date.now()
    const files = await walk(this.root)
    const seen = new Set<string>()
    let added = 0
    let changed = 0
    let dirty = false

    for (const file of files) {
      const rel = path.relative(this.root, file).split(path.sep).join('/')
      seen.add(rel)
      let st
      try {
        st = await fs.stat(file)
      } catch {
        continue
      }
      const known = this.docs.get(rel)
      if (known && known.mtimeMs === st.mtimeMs) continue

      const raw = await fs.readFile(file, 'utf8')
      this.docs.set(rel, parseDoc(rel, raw, st.mtimeMs))
      this.raws.set(rel, raw)
      dirty = true
      if (known) changed++
      else added++
    }

    let removed = 0
    for (const rel of [...this.docs.keys()]) {
      if (!seen.has(rel)) {
        this.docs.delete(rel)
        this.raws.delete(rel)
        removed++
        dirty = true
      }
    }

    if (dirty || this.lastRefresh === 0) {
      await this.rebuild()
      // The bank may teach the query layer its own words. Re-read on every rebuild, so editing the
      // file takes effect without restarting the server.
      const vocabulary = this.raws.get('dna/vocabulary.md')
      this.localVocabulary = setLocalVocabulary(vocabulary ? parseVocabulary(vocabulary) : [])
    }
    this.lastRefresh = Date.now()
    return { added, changed, removed, durationMs: Date.now() - started }
  }

  private isIndexDoc(doc: BankDoc): boolean {
    return doc.docFunction === 'index' || path.posix.basename(doc.path) === 'README.md'
  }

  private async rebuild(): Promise<void> {
    this.incoming = new Map()
    this.ownerByKey = new Map()
    this.indexLinks = []

    for (const doc of this.docs.values()) {
      doc.registeredIn = []
      for (const edge of doc.derivedFrom) {
        if (!edge.resolved) continue
        const list = this.incoming.get(edge.resolved)
        if (list) list.push(doc.path)
        else this.incoming.set(edge.resolved, [doc.path])
      }
      for (const key of doc.canonicalFor) {
        const list = this.ownerByKey.get(key)
        if (list) list.push(doc.path)
        else this.ownerByKey.set(key, [doc.path])
      }
    }

    for (const doc of this.docs.values()) {
      if (!this.isIndexDoc(doc)) continue
      const raw = this.raws.get(doc.path)
      if (raw === undefined) continue
      for (const link of extractLinks(doc.path, raw)) {
        this.indexLinks.push(link)
        if (!link.to) continue
        const target = this.docs.get(link.to)
        if (target && target.path !== doc.path) target.registeredIn.push(doc.path)
      }
    }

    const dnaBodies = new Map<string, string>()
    for (const doc of this.docs.values()) {
      const raw = this.raws.get(doc.path)
      if (doc.path.startsWith('dna/') && raw !== undefined) dnaBodies.set(doc.path, raw)
    }
    this.contract = parseContract(dnaBodies)

    // Layers are assigned at parse time from the built-in table, because parsing one document knows
    // nothing about the bank. Once `dna/` has been read we know whether this bank overrides them,
    // so the assignment is redone here rather than threaded back into the parser.
    this.layers = parseLayerMap(dnaBodies)
    if (Object.keys(this.layers.byDir).length > 0) {
      for (const doc of this.docs.values()) doc.layer = layerOf(doc.path, this.layers)
    }
  }

  /** Full file text of an indexed document, frontmatter included. */
  raw(pathname: string): string | undefined {
    return this.raws.get(pathname.replace(/^\.?\//, ''))
  }

  get(pathname: string): BankDoc | undefined {
    return this.docs.get(pathname.replace(/^\.?\//, ''))
  }

  all(): BankDoc[] {
    return [...this.docs.values()]
  }
}
