# memorybank-mcp

MCP-сервер поверх `memory_bank`: маршрутизация, чтение по секциям, проверка governance.

Спека — [specification.md](specification.md), план — [implementation-plan.md](implementation-plan.md).

Готово всё по плану: **E0** индекс, **E1** чтение, **E2** валидация, **E3** граф, **E4** поиск и дельта, **E5** запись.

## Запуск

```bash
npm install && npm run build
```

Как MCP-сервер (stdio):

```bash
node dist/cli.js --root /path/to/project/memory_bank
```

Подключение в проекте:

```json
{
  "mcpServers": {
    "memorybank": {
      "command": "node",
      "args": ["/абсолютный/путь/dist/cli.js", "--root", "/абсолютный/путь/memory_bank"]
    }
  }
}
```

## Отладка из терминала

```bash
node dist/cli.js --root <bank> --stats
node dist/cli.js --root <bank> --route "filter thresholds" --limit 5
node dist/cli.js --root <bank> --read domain/rules.md --section Thresholds
node dist/cli.js --root <bank> --validate --summary
node dist/cli.js --root <bank> --validate --rule broken-derived-from
node dist/cli.js --root <bank> --graph domain/rules.md --direction down --depth 1
node dist/cli.js --root <bank> --search "FT-SMD-843" --limit 5
node dist/cli.js --root <bank> --changed HEAD~5
node dist/cli.js --root <bank> --create adr/ADR-...-name.md --kind adr --title "..." --purpose "..." --derived ../engineering/architecture.md --dry-run
node dist/cli.js --root <bank> --list-inbox
node dist/cli.js --root <bank> --promote _inbox/note.md --to engineering/thing.md --derived ../dna/principles.md --dry-run
```

## Что уже есть

| Инструмент | Что делает |
|---|---|
| `bank_route` | «что читать по этому вопросу» — ранжирование по `canonical_for`, `purpose`, `title`, заголовкам |
| `bank_read` | документ целиком или одна секция второго уровня |
| `bank_validate` | проверка банка по правилам, объявленным в его же `dna/` |
| `bank_graph` | обход `derived_from`: `down` — кто зависит (радиус изменения), `up` — на чём построен |
| `bank_search` | полнотекстовый поиск по телу документов — идентификаторы, имена, литералы |
| `bank_changed` | что изменилось с git-ref или ISO-даты |
| `bank_create` | создание документа из шаблона банка с регистрацией в индексе, с гейтами и `_inbox` |
| `bank_promote` | перенос заметки из `_inbox/` в канонический слой с регистрацией и удалением исходника |

| Ресурс | Содержимое |
|---|---|
| `memorybank://index` | аннотированный индекс всех документов (без шаблонов) |
| `memorybank://schema/frontmatter` | `dna/frontmatter.md` самого банка, дословно |
| `memorybank://health` | свежий результат `bank_validate`, сгруппированный по правилам |
| `memorybank://inbox` | что лежит в карантине, старое сверху |

Промпты: `route-then-read` (сначала маршрут, потом чтение), `check-before-commit`
(прогнать валидацию и объяснить каждую находку), `record-adr` (собрать решение в ADR),
`review-inbox` (разобрать карантин).

### Запись

`bank_create` берёт шаблон из `flows/templates/` самого банка. Шаблоны там — обёртки: документ
для инстанцирования лежит внутри них двумя блоками под `## Instantiated Frontmatter` и
`## Instantiated Body`. Сервер разворачивает именно их, подставляет заголовок, заполняет
плейсхолдер даты и переносит `must_not_define`, который шаблон несёт как governance.

Отказывается писать, если путь занят, если `derived_from` не резолвится, если `canonical_for`
уже кем-то занят, если путь уходит за пределы банка или не оканчивается на `.md`. Незнакомый
`doc_kind` — предупреждение, а не отказ. `dryRun` показывает результат, ничего не записывая.

Регистрация в индексе копирует форму последней записи — таблица, буллет или нумерованный пункт,
— чтобы не переформатировать написанный руками файл.

`inbox: true` кладёт документ в `_inbox/` со `status: draft`, без шаблона и без регистрации.
Слой `inbox` ранжируется с множителем 0.2 и освобождён от правила `unregistered-doc`: это
карантин для автозахвата, который разбирается позже.

`bank_promote` разгружает карантин: тело заметки сохраняется как написано, frontmatter
пересобирается по контракту, шаблон назначения отдаёт только свои governance-поля, документ
регистрируется в индексе, исходник удаляется. Гейты те же, что у `bank_create`, плюс два своих:
повышать можно только из `_inbox/` и только наружу. Статус после повышения — `active`, поэтому
требование governance про `derived_from` здесь уже не смягчается.

Наполняется карантин Stop-хуком — см. [hooks/README.md](hooks/README.md).

### Правила валидации

Прогон по 19 реальным банкам — 321 находка.

| Правило | Severity | Находок |
|---|---|---|
| `unknown-enum-value` | warning | 212 |
| `broken-derived-from` | error | 38 |
| `invalid-frontmatter` | error | 22 |
| `cycle-in-derived-from` | error | 15 |
| `unregistered-doc` | warning | 13 |
| `unresolved-rule-reference` | warning | 13 |
| `no-contract` | warning | 6 |
| `ssot-conflict` | error | 1 |
| `missing-derived-from` | error | 1 |
| `must-not-define-violated` | error | 0 |
| `dangling-index-entry` | error | 0 |

Структурные правила работают в любом банке. Контрактные (`missing-derived-from`, циклы,
`unknown-enum-value`) применяются только там, где банк сам их объявил в `dna/governance.md`
— сервер исполняет правила банка, а не свои.

## Решения, отличающие реализацию от спеки

- **Схема читается из банка.** `doc_kind` / `doc_function` / `status` — открытые множества, вычитанные
  из `dna/frontmatter.md` и `dna/governance.md`. Жёсткий enum отверг бы 101 документ из 1153.
- **Слой документа** (`dna` / `knowledge` / `decision` / `delivery` / `flow`) выводится из пути и
  участвует в ранжировании. Без него на банке, где 80% документов — журнал доставки, маршрутизация
  промахивается.
- **`derived_from` резолвится относительно документа**, поддерживает обе формы — строку и `{ path, fit }`.
- **Ссылка за пределы корня** помечается `external`, а не считается битой: в моно-репо банки вложены.
- **Документ с невалидным YAML не выпадает из индекса.** 22 документа в реальных банках имеют
  неэкранированное двоеточие в `purpose`; их метаданные восстанавливаются построчно, а ошибка
  сохраняется для будущего `bank_validate`.
- **Шаблоны исключены из выдачи** `bank_route` и из `memorybank://index`.
- **`bank_route` и `bank_search` отвечают на разные вопросы.** Первый ранжирует по рукописной шапке
  («какой документ про это»), второй ищет по прозе («где встречается эта строка»). В поиске целый
  токен весит вдесятеро больше своих частей: иначе запрос `FT-SMD-843` поднимал бы реестр
  `features/README.md` с семьюдесятью строками `FT-SMD-*` выше самой фичи.
- **Frontmatter разбирается в одном месте.** `gray-matter` без опций кэширует результат по тексту и
  после исключения возвращает из кэша объект, у которого весь frontmatter лежит внутри `content` —
  молча. Опции передаются всегда, разбор идёт через единый `splitFrontmatter`.
- **Граф отделяет три исхода ребра:** внутреннее (узел), внешнее (`external` — вложенный банк),
  битое (`broken`). Обход по ширине с потолком узлов, поэтому документ-хаб не вытягивает весь банк,
  а цикл не зацикливает.

## Тесты

```bash
npm test
```

140 тестов. `test/fixture-bank/` — банк с намеренными нарушениями (битое ребро, второй владелец
факта, сирота, сломанный YAML, ссылка за пределы корня). `test/acceptance.test.ts` прогоняет
критерии готовности из плана по реальным банкам и пропускается, если их нет на машине.
