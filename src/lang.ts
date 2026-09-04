/**
 * Bilingual query support.
 *
 * The banks themselves are written in English — that is a deliberate rule, and nothing here changes
 * it. What changes is the question: a query typed by hand is often Russian, and lexical ranking over
 * English fields cannot answer it at all. "где пороги фильтрации" tokenizes to three words that
 * appear nowhere in `purpose` or `canonical_for`, so the result set is empty rather than wrong.
 *
 * The dictionary below is a domain vocabulary, not a general one, and it has two layers. The first
 * was taken from the most frequent words in `title` / `purpose` / `canonical_for` across 19 real
 * banks, plus the governance terms the flows use — the vocabulary of banks. The second is the
 * vocabulary of the things banks describe, added after the first layer was measured answering
 * questions about the bank and returning nothing at all for questions about the product. It is a
 * routing aid, not a translator; genuinely project-specific terms belong in `dna/vocabulary.md`,
 * which overlays this at load time.
 */

/** Russian is heavily inflected, so a dictionary entry is a stem prefix, not a word. */
type Entry = readonly [ru: string, ...en: string[]]

/**
 * Keyed by the longest Russian prefix that stays unambiguous under inflection: `порог` covers
 * порог / пороги / порогов / порогам, `реш` covers решение / решения / решить / решил.
 */
const DICTIONARY: readonly Entry[] = [
  // structure of the bank
  ['банк', 'bank'],
  ['баз', 'base', 'database'],
  ['документ', 'document', 'documentation', 'docs'],
  ['знани', 'knowledge'],
  ['индекс', 'index'],
  ['карантин', 'quarantine', 'inbox'],
  ['навигац', 'navigation', 'navigate'],
  ['памят', 'memory'],
  ['раздел', 'section'],
  ['реестр', 'registry'],
  ['регистрац', 'registration', 'registered'],
  ['слой', 'layer'],
  ['шаблон', 'template'],

  // governance
  ['владел', 'owner', 'canonical', 'owns'],
  ['гейт', 'gate'],
  ['границ', 'boundary', 'boundaries'],
  ['контракт', 'contract'],
  ['ограничен', 'constraint', 'boundaries'],
  ['политик', 'policy'],
  ['правил', 'rule', 'rules'],
  ['принцип', 'principle', 'principles'],
  ['статус', 'status'],
  ['схем', 'schema'],
  ['фронтматтер', 'frontmatter'],
  ['валидац', 'validation', 'validate'],
  ['провер', 'validation', 'check', 'verification'],

  // decisions and delivery
  ['адр', 'adr'],
  ['альтернатив', 'alternative', 'alternatives'],
  ['вариант', 'option', 'options'],
  ['дизайн', 'design'],
  ['доставк', 'delivery'],
  ['задач', 'task'],
  ['исполнен', 'execution'],
  ['компромисс', 'trade-off', 'tradeoff'],
  ['обоснован', 'rationale', 'justification'],
  ['пакет', 'package'],
  ['план', 'plan', 'planning'],
  ['последств', 'consequence', 'consequences'],
  ['релиз', 'release'],
  ['реш', 'decision', 'adr', 'decided'],
  ['риск', 'risk', 'risks'],
  ['сценар', 'scenario', 'use'],
  ['требован', 'requirement', 'requirements'],
  ['фич', 'feature'],
  ['этап', 'stage', 'stages'],
  ['эпик', 'epic'],

  // product and domain
  ['аудитор', 'audience'],
  ['глоссар', 'glossary'],
  ['домен', 'domain'],
  ['контекст', 'context'],
  ['метрик', 'metric', 'metrics'],
  ['модел', 'model'],
  ['проблем', 'problem'],
  ['продукт', 'product'],
  ['словар', 'glossary', 'vocabulary', 'dictionary'],
  ['событ', 'event', 'events'],
  ['состоян', 'state', 'states'],
  ['термин', 'term', 'vocabulary'],
  ['цел', 'goal', 'goals'],

  // engineering
  ['архитектур', 'architecture'],
  ['аутентифик', 'authentication', 'auth'],
  ['авториз', 'authorization', 'auth'],
  ['бэкенд', 'backend'],
  ['бекенд', 'backend'],
  ['зависимост', 'dependency', 'dependencies'],
  ['интеграц', 'integration'],
  ['код', 'code'],
  ['конвенц', 'convention', 'conventions'],
  ['миграц', 'migration'],
  ['очеред', 'queue'],
  ['подводн', 'gotcha', 'gotchas'],
  ['грабл', 'gotcha', 'gotchas'],
  ['разработ', 'development', 'developer'],
  ['репозитор', 'repository'],
  ['сборк', 'build'],
  ['сервис', 'service', 'services'],
  ['систем', 'system'],
  ['тест', 'test', 'testing', 'tests'],
  ['фронтенд', 'frontend'],
  ['функц', 'function'],
  ['хранилищ', 'storage'],
  ['ошибк', 'error', 'errors'],
  ['логирован', 'logging', 'logs'],
  ['кеш', 'cache'],
  ['кэш', 'cache'],
  ['токен', 'token'],
  ['ключ', 'key', 'keys'],
  ['данн', 'data'],
  ['формат', 'format', 'formats'],
  ['парс', 'parser', 'parsing', 'parse'],
  ['разбор', 'parsing', 'parse'],
  ['сбор', 'collection', 'collect'],
  ['собир', 'collection', 'collect'],
  ['расширен', 'extension'],
  ['блокировк', 'blocked', 'block'],
  ['заблокир', 'blocked', 'block'],
  ['браузер', 'browser'],
  ['выкат', 'deployment', 'rollout'],
  ['клиент', 'client'],
  ['запрос', 'query', 'request'],
  ['запис', 'write', 'record'],
  ['чтени', 'read'],
  ['поиск', 'search'],
  ['маршрут', 'route', 'routing'],
  ['граф', 'graph'],
  ['цикл', 'cycle', 'cycles'],
  ['ребр', 'edge', 'edges'],
  ['узел', 'node'],
  ['узл', 'node', 'nodes'],
  ['дерев', 'tree'],
  ['фильтр', 'filter', 'filtering'],
  ['порог', 'threshold', 'thresholds'],
  ['верси', 'version', 'versions'],
  ['конфиг', 'config', 'configuration'],
  ['настройк', 'config', 'settings'],
  ['депло', 'deployment', 'deploy'],
  ['разверт', 'deployment', 'deploy'],
  ['безопасн', 'security', 'safety'],
  ['восстановлен', 'recovery', 'restore'],
  ['окружен', 'environment'],
  ['процесс', 'process'],
  ['сесси', 'session'],
  ['проект', 'project'],
  ['спецификац', 'specification', 'spec'],
  ['заметк', 'note', 'notes'],
  ['истори', 'history'],
  ['откат', 'rollback', 'revert'],
  ['обзор', 'review'],
  ['ревью', 'review'],

  // The product the bank describes, rather than the bank. Measured on a real bank of 77 hand-written
  // documents: "как устроен разбиение книги на страницы" and "что известно про домашний экран"
  // both returned nothing, while the same two questions in English routed correctly. Every entry
  // above had been taken from the vocabulary of the banks themselves, so the layer answered
  // questions about the bank and fell silent on questions about the thing it documents — and a
  // person asking in Russian asks about the thing. Where one Russian stem carries two meanings, the
  // longer key wins by construction (RU_KEYS is sorted by length), so глава/главный and
  // удаление/удалённый are split rather than blurred.
  ['экран', 'screen'],
  ['страниц', 'page', 'pages', 'pagination'],
  ['разбиен', 'split', 'splitting', 'pagination'],
  ['разбив', 'split', 'splitting'],
  ['кнопк', 'button'],
  ['спис', 'list'],
  ['меню', 'menu'],
  ['вкладк', 'tab'],
  ['диалог', 'dialog'],
  ['макет', 'layout'],
  ['верстк', 'layout', 'markup'],
  ['интерфейс', 'interface', 'ui'],
  ['шрифт', 'font'],
  ['цвет', 'color', 'colour'],
  ['размер', 'size'],
  ['иконк', 'icon'],
  ['виджет', 'widget'],
  ['анимац', 'animation'],
  ['прокрутк', 'scroll', 'scrolling'],
  ['жестк', 'hard', 'strict'],
  ['жёстк', 'hard', 'strict'],
  ['жест', 'gesture'],
  ['ввод', 'input'],
  ['вывод', 'output', 'conclusion'],

  ['книг', 'book'],
  ['главн', 'main', 'primary'],
  ['глав', 'chapter'],
  ['текст', 'text'],
  ['слов', 'word', 'words'],
  ['предложен', 'sentence', 'proposal'],
  ['абзац', 'paragraph'],
  ['перевод', 'translation', 'translate'],
  ['язык', 'language'],
  ['изображен', 'image'],
  ['картинк', 'image', 'picture'],
  ['файл', 'file'],
  ['папк', 'folder', 'directory'],
  ['библиотек', 'library'],

  ['пользовател', 'user'],
  ['аккаунт', 'account'],
  ['профил', 'profile'],
  ['устройств', 'device'],
  ['сервер', 'server'],
  ['ответствен', 'responsibility', 'ownership'],
  ['ответ', 'response', 'answer'],
  ['сообщен', 'message'],
  ['уведомлен', 'notification'],
  ['сортиров', 'sort', 'sorting'],
  ['загруз', 'load', 'loading', 'download'],
  ['скачив', 'download'],
  ['выгрузк', 'export', 'upload'],
  ['импорт', 'import'],
  ['экспорт', 'export'],
  ['синхрониз', 'sync', 'synchronization'],
  ['офлайн', 'offline'],
  ['оффлайн', 'offline'],
  ['онлайн', 'online'],
  ['удаленн', 'remote'],
  ['удален', 'delete', 'deletion'],
  ['добавлен', 'add', 'addition'],
  ['обновлен', 'update'],
  ['экземпляр', 'instance'],
  ['сет', 'network'],
]

/** Question words carry no lexical content; they would match a `purpose` by accident. */
export const RU_STOP: readonly string[] = [
  'что', 'как', 'где', 'когда', 'кто', 'почему', 'зачем', 'какой', 'какая', 'какие', 'каком',
  'который', 'которая', 'которые', 'это', 'этот', 'эта', 'эти', 'том', 'для', 'или', 'при', 'над',
  'под', 'про', 'из', 'по', 'на', 'не', 'ни', 'но', 'же', 'ли', 'бы', 'мы', 'вы', 'он', 'она',
  'они', 'его', 'её', 'их', 'мне', 'мой', 'моя', 'наш', 'был', 'была', 'быть', 'есть', 'нет',
  'так', 'там', 'тут', 'ещё', 'еще', 'уже', 'только', 'если', 'чтобы', 'нужно', 'надо', 'можно',
  'все', 'всё', 'весь', 'себя', 'том', 'чем', 'без', 'до', 'от', 'за',
]

const CYRILLIC = /[Ѐ-ӿ]/

export function hasCyrillic(text: string): boolean {
  return CYRILLIC.test(text)
}

let RU_TO_EN = new Map<string, string[]>()
let EN_TO_RU = new Map<string, string[]>()
/** Dictionary keys longest first, so `фильтр` wins over a shorter key that also prefixes the word. */
let RU_KEYS: string[] = []

function build(extra: readonly Entry[]): void {
  RU_TO_EN = new Map()
  EN_TO_RU = new Map()
  for (const [ru, ...en] of [...DICTIONARY, ...extra]) {
    RU_TO_EN.set(ru, [...(RU_TO_EN.get(ru) ?? []), ...en])
    for (const word of en) EN_TO_RU.set(word, [...(EN_TO_RU.get(word) ?? []), ru])
  }
  RU_KEYS = [...RU_TO_EN.keys()].sort((a, b) => b.length - a.length)
}
build([])

/**
 * Terms this bank adds, from an optional `dna/vocabulary.md`.
 *
 * The built-in dictionary was drawn from the most frequent terms across a body of real banks, and it
 * carries their subject matter — agents, deployment, frontend, backend. Point the server at a
 * project about parsing books and the Russian side goes silent on `корпус`, `книга`, `прогон`: not a
 * poor answer, an empty one, while the same question in English lands three ways out of three. The
 * English side never has this problem because it is read from the bank itself; the Russian side
 * cannot be, since the bank is English by governance rule. So the owner writes it down.
 */
export function setLocalVocabulary(entries: readonly (readonly string[])[]): number {
  const extra: Entry[] = []
  for (const row of entries) {
    const [ru, ...en] = row
    if (!ru || !hasCyrillic(ru) || en.length === 0) continue
    extra.push([ru.toLowerCase(), ...en.map((w) => w.toLowerCase())] as unknown as Entry)
  }
  build(extra)
  return extra.length
}

/**
 * Reads `| корпус | corpus, collection |` rows out of a markdown table. Anything that is not a
 * two-column row with a Cyrillic left side is ignored, so the file can carry prose and a heading
 * around the table without a parser for either.
 */
export function parseVocabulary(markdown: string): string[][] {
  const rows: string[][] = []
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|') || /^\|[\s:|-]+\|$/.test(trimmed)) continue
    const cells = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim())
    if (cells.length < 2) continue
    const ru = (cells[0] ?? '').replace(/`/g, '').trim()
    const en = (cells[1] ?? '')
      .replace(/`/g, '')
      .split(',')
      .map((w) => w.trim())
      .filter((w) => /^[a-z][a-z0-9_-]*$/i.test(w))
    if (!hasCyrillic(ru) || en.length === 0) continue
    rows.push([ru, ...en])
  }
  return rows
}

/**
 * Russian builds verbs by prefix as readily as by ending: `задеплоить` is `деплой` with both ends
 * changed, and no suffix rule reaches it. Stripping a prefix is only accepted when what remains
 * lands on a dictionary key, which keeps the damage of a wrong split to nothing.
 */
const VERB_PREFIXES = ['пере', 'раз', 'при', 'про', 'под', 'об', 'за', 'вы', 'от', 'до', 'на']

/**
 * The dictionary key a Russian token falls under. It doubles as a stem: `порогов` and `пороги` both
 * reduce to `порог`, which is what makes prefix lookup in the search index work across inflection.
 */
export function stemOf(token: string): string | undefined {
  if (!hasCyrillic(token)) return undefined
  const direct = RU_KEYS.find((key) => token.startsWith(key))
  if (direct) return direct
  for (const prefix of VERB_PREFIXES) {
    if (!token.startsWith(prefix) || token.length - prefix.length < 4) continue
    const rest = token.slice(prefix.length)
    const key = RU_KEYS.find((k) => rest.startsWith(k))
    if (key) return key
  }
  return undefined
}

/** A query word together with everything it should also match. */
export interface QueryTerm {
  /** The word as typed. Always scored at full weight. */
  literal: string
  /** Equivalents in the other language, scored slightly below the literal. */
  translations: string[]
  /** The stem to expand by prefix against an index, when the token is inflected Russian. */
  stem?: string
}

export function termFor(token: string): QueryTerm {
  if (hasCyrillic(token)) {
    const stem = stemOf(token)
    return { literal: token, translations: stem ? [...new Set(RU_TO_EN.get(stem)!)] : [], stem }
  }
  return { literal: token, translations: [...new Set(EN_TO_RU.get(token) ?? [])] }
}

export function expandTerms(tokens: string[]): QueryTerm[] {
  return tokens.map(termFor)
}

/**
 * ADRs exist to answer "why"; a why-question should outrank the component description. Both
 * languages are listed because intent is detected on the raw question, before tokenizing.
 */
export const WHY_INTENT =
  /(\bwhy\b|\brationale\b|\bdecision\b|\bdecided\b|instead of|trade-?off|почему|зачем|обоснован|вместо|решени)/i
