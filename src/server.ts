import fs from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { Bank } from './bank.js'
import { route } from './route.js'
import { read, readMany } from './read.js'
import { RULES, validate } from './validate.js'
import { graph } from './graph.js'
import { SearchIndex, search } from './search.js'
import { changed } from './changed.js'
import { create, discard, inbox, promote } from './create.js'
import { init } from './init.js'
import { edit, setStatus, updateSection } from './update.js'

const LAYERS = ['dna', 'knowledge', 'decision', 'delivery', 'flow', 'other'] as const

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

export async function startServer(bank: Bank): Promise<void> {
  const searchIndex = new SearchIndex()
  const server = new McpServer(
    { name: 'memorybank', version: '0.1.0' },
    {
      instructions:
        'Navigation and governance over a memory_bank knowledge base. ' +
        'Start every session by reading memorybank://index, then call bank_route before reading any file. ' +
        'Bank documents are written in English, but the question need not be: the server expands a Russian ' +
        'query into the English terms the documents use. Pass the question as the user asked it.',
    },
  )

  server.registerTool(
    'bank_route',
    {
      title: 'Route a question to documents',
      description:
        'Answers "what should I read about this". Ranks documents by their hand-written frontmatter ' +
        '(canonical_for, purpose, title, section headings) — not by body text — and returns paths with the reason each matched. ' +
        'Templates are never returned. Ask in whatever language the user did — bank documents are English, ' +
        'and the server translates the query rather than making you do it. ' +
        'Use this instead of reading README.md and walking section indexes.',
      inputSchema: {
        question: z.string().min(2).describe('What you need to know, in the words it was asked in'),
        limit: z.number().int().min(1).max(25).optional().describe('How many documents to return (default 5)'),
        docKind: z.string().optional().describe('Restrict to one doc_kind, e.g. "adr"'),
        layer: z.enum(LAYERS).optional().describe('Restrict to one knowledge layer'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ question, limit, docKind, layer }) => {
      await bank.refresh()
      const results = route(bank, question, { limit, docKind, layer })
      if (results.length === 0) {
        return json({
          results: [],
          hint: 'No frontmatter match. Try bank_search for a literal term, or widen the question.',
        })
      }
      return json({ results })
    },
  )

  server.registerTool(
    'bank_read',
    {
      title: 'Read bank documents',
      description:
        'Reads one document, or several in a single call, by bank-relative path — optionally a ' +
        'single level-two section of each. Pass an array whenever you need more than one: reading ' +
        'a handful of documents is one call, not one call each, and there is never a reason to ' +
        'shell out to cat instead. Section reads matter: canonical documents in real banks reach ' +
        '190 KB. Returns parsed frontmatter alongside the body. A path that does not resolve is ' +
        'reported under failed without sinking the rest of the batch. A batch has a byte budget, spent in the order asked; whatever it does not reach comes back under skipped with its section list, so ask for those by section rather than repeating the whole read. Ten whole documents do not fit in one answer, and asking for them anyway returns a file path instead of the text.',
      inputSchema: {
        path: z
          .union([z.string(), z.array(z.union([z.string(), z.object({ path: z.string(), section: z.string().optional() })]))])
          .describe('One bank-relative path, or an array of paths (each optionally {path, section})'),
        section: z.string().optional().describe('Level-two heading to return instead of the whole body'),
        maxBytes: z
          .number()
          .int()
          .min(1000)
          .optional()
          .describe('Lower the byte budget of a multi-path read. It cannot be raised: a bigger answer reaches you as a file path, not as text. Default and ceiling 40000'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ path: docPath, section, maxBytes }) => {
      await bank.refresh()
      try {
        if (Array.isArray(docPath)) {
          const requests = docPath.map((r) => (typeof r === 'string' ? { path: r, section } : r))
          return json(await readMany(bank, requests, { maxBytes }))
        }
        return json(await read(bank, docPath, section))
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'bank_init',
    {
      title: 'Create a bank where there is none',
      description:
        'Seeds an empty root with the fourteen-directory skeleton, the governance set (dna/), the flows and ' +
        'templates, one registered index per section, and draft stubs for the two documents the flow refers ' +
        'to. Everything written becomes the bank\'s own — the starter is a starting point, not a schema the ' +
        'server keeps enforcing. A bank created this way validates clean; refuses to seed over existing ' +
        'documents unless force is passed.',
      inputSchema: {
        name: z.string().min(1).describe('Project name, used in the root index'),
        dryRun: z.boolean().optional().describe('List what would be written without writing it'),
        force: z.boolean().optional().describe('Seed even though the directory already holds documents'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ name, dryRun, force }) => {
      await bank.refresh()
      try {
        return json(await init(bank, { name, dryRun, force }))
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'bank_create',
    {
      title: 'Create a governed document',
      description:
        "Creates a document from the bank's own template, writes the frontmatter the contract asks for, and " +
        'registers it in the section index — one operation, so the registration step cannot be forgotten. ' +
        'Refuses to write when the path is taken, when a derived_from target does not resolve, or when ' +
        'canonical_for is already owned elsewhere. Pass dryRun to see what would land before it lands. ' +
        'Use inbox for a capture that has not been reviewed yet: it goes to _inbox/ as a draft, outside navigation.',
      inputSchema: {
        docKind: z.string().describe('doc_kind of the new document, e.g. "adr"'),
        path: z.string().describe('Bank-relative path, e.g. "adr/ADR-20260829T120000Z-short-name.md"'),
        title: z.string().min(1).describe('Document title'),
        purpose: z.string().min(1).describe('One line saying when to read this — the signal bank_route ranks on'),
        derivedFrom: z.array(z.string()).optional().describe('Upstream documents, written relative to the new file'),
        canonicalFor: z.array(z.string()).optional().describe('Fact keys this document will own'),
        mustNotDefine: z.array(z.string()).optional().describe('Fact keys this document must not define'),
        status: z.string().optional().describe('Publication status (default draft)'),
        body: z
          .string()
          .optional()
          .describe('The document body below the title. Supply it here rather than writing the file afterwards'),
        bodyFile: z
          .string()
          .optional()
          .describe(
            'Read the body from this file instead — absolute, or relative to the server. Exactly one ' +
              'of body and bodyFile.',
          ),
        extra: z.record(z.string(), z.unknown()).optional().describe('Additional frontmatter fields'),
        inbox: z.boolean().optional().describe('Write to the _inbox/ quarantine instead of a canonical layer'),
        dryRun: z.boolean().optional().describe('Report what would happen without writing anything'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      await bank.refresh()
      try {
        return json(await create(bank, input))
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'bank_edit',
    {
      title: 'Replace one exact fragment of a document',
      description:
        'Replaces an exact piece of text in a document body — a table row, two steps of a plan, a ' +
        'paragraph, a heading. Use this for anything smaller than a whole section, which is most ' +
        'edits; use bank_update_section when writing a section from nothing. The match must be ' +
        'unique: zero or several occurrences are refused with the count rather than guessed at, ' +
        'and section narrows the search when the same words appear twice. Renaming a heading is ' +
        'an ordinary edit here. The frontmatter is out of reach: the search runs on the body.',
      inputSchema: {
        path: z.string().describe('Bank-relative path of an existing document'),
        find: z.string().min(1).describe('Exact text to replace, whitespace included'),
        replace: z.string().describe('What to put in its place'),
        section: z.string().optional().describe('Restrict the search to one level-two section'),
        dryRun: z.boolean().optional().describe('Report what would change without writing'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      await bank.refresh()
      try {
        return json(await edit(bank, input))
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'bank_update_section',
    {
      title: 'Write one named section of an existing document',
      description:
        'Writes the body of one level-two section, leaving the frontmatter, the title and every ' +
        'other section untouched. This is how a seeded draft gets filled — bank_init writes ' +
        'product/context.md and engineering/testing-policy.md as placeholders, and bank_create ' +
        'refuses an occupied path — and how prose reaches a document created from a template. ' +
        'A section that does not exist is refused with the list of the real ones rather than ' +
        'appended. Templates are refused outright; a quarantined note can be filled in place.',
      inputSchema: {
        path: z.string().describe('Bank-relative path of an existing document'),
        section: z.string().describe('Level-two heading whose body is being written'),
        content: z.string().min(1).optional().describe('Markdown to put under that heading'),
        contentFile: z
          .string()
          .optional()
          .describe(
            'Read the markdown from this file instead — absolute, or relative to the server. Use it ' +
              'for content a script generated: it never has to pass through the call. Exactly one of ' +
              'content and contentFile.',
          ),
        mode: z
          .enum(['replace', 'append'])
          .optional()
          .describe('replace overwrites the section body (default), append adds to the end of it'),
        dryRun: z.boolean().optional().describe('Report what would change without writing'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      await bank.refresh()
      try {
        return json(await updateSection(bank, input))
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'bank_set_status',
    {
      title: 'Move a document to another lifecycle status',
      description:
        'Changes the status of a document already in place — the draft that bank_init seeded and ' +
        'bank_update_section filled becoming active, an active document being archived. This is ' +
        'the only governed way to do it: bank_edit cannot reach the frontmatter, and status is ' +
        'where the gates are, so making a document active without derived_from is refused here ' +
        'rather than discovered by bank_validate afterwards. Archiving a document that owns ' +
        'canonical_for is refused unless releaseCanonical is passed, because ownership does not ' +
        'survive retirement. Everything else in the frontmatter is left exactly as written. A note in _inbox/ is refused: use bank_promote, which places ' +
        'it and sets its status in one step.',
      inputSchema: {
        path: z.string().describe('Bank-relative path of an existing document'),
        status: z.string().min(1).describe('The status to move it to, from the values dna/ declares'),
        releaseCanonical: z
          .boolean()
          .optional()
          .describe(
            'Give up canonical_for as part of archiving. Required when archiving a document that ' +
              'owns keys: an archived owner blocks whoever should own them next.',
          ),
        dryRun: z.boolean().optional().describe('Report what would change without writing'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async (input) => {
      await bank.refresh()
      try {
        return json(await setStatus(bank, input))
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'bank_promote',
    {
      title: 'Promote a captured note out of quarantine',
      description:
        'Moves a document from _inbox/ into a canonical layer: keeps the captured body, rebuilds the ' +
        'frontmatter against the contract, merges the governance fields of the destination template, ' +
        'registers it in the section index and removes the quarantined original. Same refusals as ' +
        'bank_create — a note cannot be promoted onto a fact that already has an owner.',
      inputSchema: {
        path: z.string().describe('The quarantined document, e.g. "_inbox/note.md"'),
        to: z.string().describe('Destination, e.g. "engineering/index-invalidation.md"'),
        docKind: z.string().optional().describe('Override the captured doc_kind'),
        title: z.string().optional().describe('Override the captured title'),
        purpose: z.string().optional().describe('Override the captured purpose'),
        derivedFrom: z.array(z.string()).optional().describe('Upstream documents, relative to the destination'),
        canonicalFor: z.array(z.string()).optional().describe('Fact keys the promoted document will own'),
        mustNotDefine: z.array(z.string()).optional(),
        status: z.string().optional().describe('Publication status after promotion (default active)'),
        dryRun: z.boolean().optional().describe('Report what would happen without writing anything'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => {
      await bank.refresh()
      try {
        return json(await promote(bank, input))
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'bank_discard',
    {
      title: 'Drop a captured note that is not worth keeping',
      description:
        'Deletes one document from _inbox/, and nothing else — the third outcome of an inbox ' +
        'review, alongside bank_promote and folding a note into its owner with ' +
        'bank_update_section. A reason is required, so a note is dropped on the record rather ' +
        'than silently. Refuses any path outside _inbox/: documents in the bank proper are ' +
        'removed by hand, deliberately.',
      inputSchema: {
        path: z.string().describe('Quarantined document, e.g. "_inbox/note.md"'),
        reason: z.string().min(1).describe('Why it is not worth keeping — recorded in the result'),
        dryRun: z.boolean().optional().describe('Report what would go without deleting it'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    },
    async (input) => {
      await bank.refresh()
      try {
        return json(await discard(bank, input))
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'bank_search',
    {
      title: 'Full-text search of document bodies',
      description:
        'Searches the prose, unlike bank_route which ranks by hand-written frontmatter. Reach for it when ' +
        'looking for a literal string no `purpose` would mention — an identifier such as REQ-04 or FT-SMD-843, ' +
        'a function name, an external service — or when bank_route came back empty. Templates are excluded.',
      inputSchema: {
        query: z.string().min(2).describe('Literal terms to find in document bodies'),
        limit: z.number().int().min(1).max(50).optional().describe('How many documents to return (default 10)'),
        docKind: z.string().optional().describe('Restrict to one doc_kind'),
        layer: z.enum(LAYERS).optional().describe('Restrict to one knowledge layer'),
        status: z.string().optional().describe('Restrict to one status, e.g. "active"'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ query, limit, docKind, layer, status }) => {
      await bank.refresh()
      searchIndex.sync(bank)
      const results = search(bank, searchIndex, query, { limit, docKind, layer, status })
      if (results.length === 0) {
        return json({ results: [], hint: 'No document body contains these terms. Try bank_route for a topic.' })
      }
      return json({ results })
    },
  )

  server.registerTool(
    'bank_changed',
    {
      title: 'What moved in the bank since a point in time',
      description:
        'Hands the next session the delta instead of the whole bank. A git ref gives a true delta including ' +
        'deletions and renames; an ISO date falls back to modification times, which only see what exists now.',
      inputSchema: {
        since: z.string().min(3).describe('A git ref (commit, tag, HEAD~5) or an ISO date such as 2026-08-01'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ since }) => {
      await bank.refresh()
      try {
        return json(await changed(bank, since))
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'bank_graph',
    {
      title: 'Walk the derived_from graph',
      description:
        'Answers "what else must I touch". `down` returns the documents that lean on this one — the blast ' +
        'radius of a change; `up` returns what it is built on. The link exists only as a one-way field in each ' +
        "document's frontmatter, so the downstream direction cannot be read from any single file. " +
        'Edges carry `fit` where the bank narrows what is actually inherited.',
      inputSchema: {
        path: z.string().describe('Bank-relative path of the document to start from'),
        direction: z
          .enum(['up', 'down', 'both'])
          .optional()
          .describe('down = who depends on it (default), up = what it depends on'),
        depth: z.number().int().min(1).max(6).optional().describe('How many hops to follow (default 2)'),
        limit: z.number().int().min(1).max(300).optional().describe('Maximum documents to return (default 60)'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ path: docPath, direction, depth, limit }) => {
      await bank.refresh()
      try {
        return json(graph(bank, docPath, { direction, depth, limit }))
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'bank_validate',
    {
      title: 'Check the bank against its own governance',
      description:
        'Runs the rules the bank itself declares in dna/ — broken and missing derived_from, cycles, ' +
        'unparseable frontmatter, duplicate owners of a fact, values outside the declared contract, ' +
        'unregistered documents, and prose that points at a path which does not resolve. ' +
        'Findings are graph-level properties: none of them is visible from reading one document.',
      inputSchema: {
        scope: z.string().optional().describe('Restrict to one subdirectory, e.g. "features"'),
        severity: z.enum(['error', 'warning']).optional().describe('Return only this severity'),
        rule: z.enum(RULES).optional().describe('Return only this rule'),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ scope, severity, rule }) => {
      await bank.refresh()
      const findings = await validate(bank, { scope, severity, rule })
      const byRule: Record<string, number> = {}
      for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
      return json({
        total: findings.length,
        errors: findings.filter((f) => f.severity === 'error').length,
        warnings: findings.filter((f) => f.severity === 'warning').length,
        byRule,
        findings,
      })
    },
  )

  server.registerResource(
    'index',
    'memorybank://index',
    {
      title: 'Annotated bank index',
      description:
        'Every document with its purpose, kind, layer and status. Read this first in a session, instead of README.md.',
      mimeType: 'application/json',
    },
    async (uri) => {
      await bank.refresh()
      const docs = bank
        .all()
        .filter((d) => d.docFunction !== 'template')
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((d) => ({
          path: d.path,
          title: d.title,
          purpose: d.purpose,
          docKind: d.docKind,
          layer: d.layer,
          status: d.status,
          ...(d.canonicalFor.length ? { canonicalFor: d.canonicalFor } : {}),
        }))
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ root: bank.root, count: docs.length, documents: docs }, null, 2),
          },
        ],
      }
    },
  )

  server.registerResource(
    'frontmatter-schema',
    'memorybank://schema/frontmatter',
    {
      title: 'Frontmatter contract',
      description:
        "The bank's own frontmatter contract, served verbatim from dna/. The server does not invent a schema.",
      mimeType: 'text/markdown',
    },
    async (uri) => {
      await bank.refresh()
      const source = bank.contract.source.find((p) => p.endsWith('frontmatter.md'))
      const text = source
        ? await fs.readFile(bank.abs(source), 'utf8')
        : 'This bank has no dna/frontmatter.md. The server runs in degraded mode: routing and reading only, no contract checks.'
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }
    },
  )


  server.registerResource(
    'health',
    'memorybank://health',
    {
      title: 'Bank health',
      description: 'Current bank_validate result, grouped by rule. Read before committing changes to the bank.',
      mimeType: 'application/json',
    },
    async (uri) => {
      await bank.refresh()
      const findings = await validate(bank)
      const byRule: Record<string, number> = {}
      for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                root: bank.root,
                documents: bank.docs.size,
                contract: bank.contract.present ? bank.contract.source : null,
                errors: findings.filter((f) => f.severity === 'error').length,
                warnings: findings.filter((f) => f.severity === 'warning').length,
                byRule,
                findings,
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )


  server.registerResource(
    'inbox',
    'memorybank://inbox',
    {
      title: 'Quarantine',
      description:
        'Captured notes waiting to be reviewed, oldest first. Nothing here is part of navigation until ' +
        'it is promoted or deleted.',
      mimeType: 'application/json',
    },
    async (uri) => {
      await bank.refresh()
      const entries = inbox(bank)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ root: bank.root, count: entries.length, entries }, null, 2),
          },
        ],
      }
    },
  )

  server.registerPrompt(
    'session-start',
    {
      title: 'Open a session on this bank',
      description:
        'What is this project, where did it stop, what is open — answered from the index and the ' +
        'delta rather than by reading everything.',
      argsSchema: {
        since: z
          .string()
          .optional()
          .describe('Git ref or ISO date to compare against; the default reaches back twenty commits, or to the first one in a younger repository'),
      },
    },
    ({ since }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'Bring me up to date on this project from its memory bank.\n\n' +
              'Procedure: read memorybank://index for what exists and what each document is for, ' +
              `then call bank_changed with since "${since ?? 'HEAD~20'}" for what has moved lately. ` +
              'Read documents only where the index leaves the answer genuinely unclear, and read ' +
              'them with bank_read — several paths in one call, sections where you can. Do not cat ' +
              'the bank: the index carries every purpose line already.\n\n' +
              'Then tell me, in this order: what the project is, in two sentences; what is in ' +
              'flight, with the delivery documents that carry it; what decisions were taken most ' +
              'recently; and what is open — questions recorded in the bank, drafts that never ' +
              'became active, and anything the index promises that does not exist. Be specific ' +
              'about what you did not read, so I can tell the difference between "nothing there" ' +
              'and "did not look".',
          },
        },
      ],
    }),
  )


  server.registerPrompt(
    'route-then-read',
    {
      title: 'Route before reading',
      description: 'Discipline against reading the whole bank: route first, then read only the top results.',
      argsSchema: { question: z.string().describe('The question to answer from the bank') },
    },
    ({ question }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Answer this from the memory bank: ${question}\n\n` +
              'Procedure: call bank_route first. Read only the top results it returns, and prefer a section-scoped ' +
              'bank_read over a whole-document read. Do not open README.md or a section index to find a path — that ' +
              'is what bank_route replaces. If bank_route returns nothing useful, say so instead of reading broadly.',
          },
        },
      ],
    }),
  )


  server.registerPrompt(
    'check-before-commit',
    {
      title: 'Check the bank before committing',
      description: 'Run bank_validate and explain every finding in the terms of the rule it breaks.',
      argsSchema: { scope: z.string().optional().describe('Restrict the check to one subdirectory') },
    },
    ({ scope }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Run bank_validate${scope ? ` with scope "${scope}"` : ''} and report the result.\n\n` +
              'For each finding: name the rule it breaks, say which document owns the problem, and propose the ' +
              'smallest fix. Group by rule rather than listing findings one by one. Errors first; do not bury an ' +
              'error under a list of warnings. If a rule fires many times with the same shape, say so once and ' +
              'give the count instead of repeating it. Do not fix anything without being asked.',
          },
        },
      ],
    }),
  )


  server.registerPrompt(
    'record-adr',
    {
      title: 'Record a decision as an ADR',
      description: "Collect a decision into the bank's ADR shape and create it through bank_create.",
      argsSchema: { decision: z.string().describe('The decision to record') },
    },
    ({ decision }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Record this decision as an ADR: ${decision}\n\n` +
              'First read memorybank://schema/frontmatter and bank_route the topic, so the ADR points at the ' +
              'documents it actually follows from. Then call bank_create with docKind "adr" and a path of the ' +
              'form adr/ADR-<UTC timestamp YYYYMMDDTHHMMSSZ>-short-decision-name.md — the template body carries ' +
              'the sections to fill: context, decision drivers, the options table, the decision itself, and its ' +
              'consequences. Set decision_status to proposed and status to draft; neither becomes accepted ' +
              'without a human. Fill the options table with real alternatives and say why each was not chosen — ' +
              'an ADR with one option recorded is not a decision record. Run bank_create with dryRun first and ' +
              'show me the result before writing.',
          },
        },
      ],
    }),
  )


  server.registerPrompt(
    'review-inbox',
    {
      title: 'Review the quarantine',
      description: 'Go through captured notes and decide, one by one, what to promote and what to drop.',
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'Read memorybank://inbox and take me through what is waiting there.\n\n' +
              'For each note: say in one line what it claims, then bank_route its topic to find who already ' +
              'owns that fact. Recommend one of three outcomes, each of which has a tool: promote it as a ' +
              'new document with bank_promote, fold it into the existing owner with bank_update_section, ' +
              'or drop it as transient with bank_discard. Prefer folding over promoting: a new document ' +
              'is only right when no existing owner covers the fact, and a note folded in is a note to ' +
              'discard afterwards, with the destination as the reason. Give the exact call for whatever ' +
              'you recommend and run it with dryRun first. Do not promote, fold or discard anything until ' +
              'I say which ones.',
          },
        },
      ],
    }),
  )

  await server.connect(new StdioServerTransport())
}
