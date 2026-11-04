# Agent Buddy: module contracts

Everything is plain ES modules (JS/JSX, no TypeScript), bundled by esbuild, tested with `node --test` through
`tests/run.js` (every `tests/*.test.js` is bundled and run; `node tests/run.js pii` runs files whose name contains "pii").
Keep modules pure where possible (no `chrome.*`, no `fetch`), inject dependencies, and add unit tests next to the work.

## Data flow

```
SN page ── content script (src/content): detect record, GET-only reads with the user's session
              │  ContextPack (plain JSON)
              ▼
service worker (src/background): policy, firewall, preview/confirm, provider call, audit, budget
              │  text with placeholders only goes out; the response is re-hydrated locally
              ▼
side panel (src/sidepanel): safe renderer, Insert / Copy
```

## ContextPack (produced by src/context, consumed by the firewall)

```js
{
  version: 1,
  table: 'incident',              // table name
  sysId: '32 hex chars',
  number: 'INC0010001',
  kind: 'incident' | 'problem' | 'change' | 'request' | 'requested_item' | 'catalog_task' | 'case' | 'hr_case' | 'task' | 'other',
  fields: { short_description: 'text', state: 'In Progress', ... },   // display values, ONLY fields on the allowlist
  people: [ { role: 'caller', name: 'Abel Tuter', email: 'abel.tuter@example.com', sysId: '...' }, ... ],
  journal: [ { when: '2026-10-26 09:14:03', by: 'Beth Anglin', type: 'comment' | 'work_note', text: '...' }, ... ], // newest last
  related: { ... },               // per-kind extras (SLAs, approvals, child tasks, variables), plain data
  access: [ { source: 'task_sla', status: 'ok' | 'denied' | 'empty' | 'error', note: '' } ],   // what could not be read and why
}
```

Rules: values are strings; no HTML; no raw sys_id references except `sysId`/`people[].sysId`; text fields are capped
(see `LIMITS` in src/context). Nothing outside the feature's field allowlist is ever put in a pack.

## Firewall (src/pii/firewall.js)

```js
const fw = createFirewall({
  mode: 'standard' | 'strict' | 'local-only',
  people: ContextPack['people'],      // exact names/emails known for THIS record, masked precisely
  blockedFields: [],                  // field names that must never be sent (policy)
  endpointIsLocal: false,             // true when the AI endpoint is localhost
});

fw.buildRequest({
  feature: 'record-summary',          // id of the use case
  table: 'incident',
  system: 'instructions text (trusted, contains no ticket data)',
  parts: [ { label: 'short_description', field: 'short_description', text: '...' }, ... ],   // untrusted ticket text
  userInstruction: 'Summarise this ticket.',                                                // trusted
}) → SealedRequest

SealedRequest = frozen {
  messages: [ { role: 'system' | 'user', content } ],     // placeholders only; ticket text wrapped in untrusted-data delimiters
  preview: string,                                        // EXACT outgoing text, for the preview panel
  stats: { total: 3, counts: { EMAIL: 1, PERSON: 2 } },   // numbers only, never values; goes to the audit log
  feature, table, mode,
}

fw.rehydrate(text) → text with placeholders replaced by the real values (local only)
fw.scan(text) → Finding[]    // detect without replacing; Finding = { kind, start, end, value, confidence }
```

Fail closed: any thrown error, any blocked field in `strict` mode, or a non-local endpoint in `local-only` mode makes
`buildRequest` throw `FirewallError` (`error.code` = 'BLOCKED_FIELD' | 'NOT_LOCAL' | 'REDACTION_FAILED') and nothing is sent.

The provider dispatcher calls `assertSealed(request)` (src/pii/seal.js) first. `seal()` is imported only inside src/pii/.

## Safe text (src/render)

`parseSafeText(text) → Block[]` turns model output into plain, renderable blocks (paragraph, heading, list, code, quote).
No HTML, no images, no links that load anything; URLs are shown as text. `<SafeText text />` renders the blocks.

## Snippets (src/snippets)

`renderSnippet(template, variables) → { text, missing: [names] }` with `{{caller.first_name}}`-style variables and
`{{x | fallback}}`. Unknown variables are reported in `missing`, never silently dropped.

## Messages (service worker ↔ content script ↔ panel)

Defined in src/lib/messages.js (`MSG` constants). The worker validates the sender of every message (src/lib/senderCheck.js).

The one exception to "extension pages only" is the bar on the ServiceNow page: its content script may send `BAR_ACTIONS` and
`BAR_LAUNCH` to the worker (src/background/bar.js), from the top frame of an enabled instance and nothing else. `BAR_LAUNCH` leaves a
request in `chrome.storage.session` (src/lib/launch.js) that the panel reads, uses once and deletes.

## Extension points (how a feature is added without touching shared files)

Each area has its own files; add yours, do not edit another area's.

### Feature definition (`src/features/packs/<area>.js`, `export default [ ... ]`)

```js
{
  id: 'sentiment-risk',              // unique; also what policy `disabledFeatures` names
  title, description,                // shown on the Actions button
  wave: 1 | 2 | 3,                   // informational only (the build wave it came from): nothing in src reads it
  kinds: ['incident', ...],          // record kinds whose Actions list shows it. [] = not on the Actions list (a report or
                                     // compose feature that a view runs itself)
  context: 'record-summary',         // optional: the context spec (allowlist) to read the pack with; default = id
  journal: 15,                       // how many notes/comments go into the parts
  parts: (pack) => [{label, field, text}],   // optional: custom parts (default packToParts(pack, {journal}))
  insert: { field, label, fieldLabel, pick?, table? } | [ ... ] | omitted,   // omitted = Copy only. pick(plainText) chooses the
                                     // part of the answer this button inserts. `table`: refused unless the open form is of that
                                     // table (an article's short_description must not land on an incident). Customer-visible
                                     // fields (comments, close_notes, text) get the safe-to-send check first.
  system: '...',                     // the task for the model. No ticket data in it, ever.
  instruction: '...',
  requires: { minMode: 'strict' },   // optional: refuse unless the person's privacy mode is at least this (standard < strict < local-only)
  defaultOff: true,                  // optional: off until the organisation's policy turns coaching on (coachingEnabled)
  keepMasked: true,                  // optional: do NOT put real names back into the answer (text that gets published or shared)
  enrich: async (pack, { read, allowSensitive }) => pack,   // optional: add related data to the pack first; text it adds is untrusted
                                     // and reaches the AI only through parts()
  open: { table: 'kb_knowledge', label: 'Open a new article form' },   // optional: a button on the result that opens a blank form
}
```

**Quick actions.** A feature that works on a record needs a short label in `QUICK_LABELS` (src/features/quick.js) so it can be pinned to the
quick-actions bar; `tests/quick-actions.test.js` fails when it has none, and when a default or a label names a feature that does not exist.
Add it to `QUICK_DEFAULTS` only if it is one of the few actions a fulfiller uses all day.

Everything an AI feature sends goes through `prepareRun` (policy, firewall, seal) and `executeRun` (provider, audit) in
src/lib/pipeline.js. Views never call `sendChat` themselves; they use `useRun()` (src/sidepanel/useRun.js).

### Context specs (`src/context/specs/<area>.js`)

```js
export default {
  spec:    { 'sentiment-risk': { common: [columns...], by: { incident: [columns...] } } },   // what that feature may READ
  journal: { 'sentiment-risk': true },                                                       // read notes and comments?
  related: { 'sentiment-risk': ['slas', 'approvals'] },                                      // which extras (related.js)
  fieldsByKind: { knowledge: [columns...] },                                                 // display ceiling for a NEW kind
  extendFields: { incident: ['reopen_count'] },                                              // extra columns for an EXISTING kind (additive)
  limits: { text: 6000 },                                                                    // max characters kept for a long text column
};
```

A column outside the ceiling (`FIELDS_BY_KIND`) can never be read; `spec` is intersected with it. Add a column only with a reason.

### READ operations (`src/content/ops/<area>.js`)

```js
export default { opName: async (args, { deps, checkRecord, checkPack, allowSensitive, currentRecord }) => plainJson };
```

`currentRecord()` (from the content script, never from the panel) resolves the record the page shows now, from its form or address;
an operation that reads the page itself (resolutionFacts on a Workspace) must check it is the record it was asked about.

GET-only through the context engine or src/content/tableApi.js; validate every argument (identifiers with `isIdentifier`, sys_ids with
`SYS_ID_RE`); never return more than the person's own session could read. The panel calls it with `read(tabId, 'opName', args)`
(src/sidepanel/ask.js).

### Panel screens

- Screens (src/sidepanel/App.jsx): Ticket (`ticket/TicketView.jsx`), and My work, Team, Write and Knowledge (`mywork/`, `team/`,
  `write/`, `knowledgeScreen/`), each an Insights and an AI Assist half drawn by `shell/ScreenView.jsx`. Props `{ page, eff, active }`.
  They work from any page of an enabled site.
- `page` carries `{ tabId, href, surface: 'classic'|'workspace'|'portal'|'other', portal: {base, pageId}|null, record, newRecord: {table, kind}|null, user }`.
- To run AI: `const run = useRun({ page, eff, record })`, then `run.run(feature, { getPack })` and render `<RunPanel run={run} eff page />`.
  A view that is not about one record builds a ContextPack-shaped object in `getPack` (its text goes through the firewall like any other).
- To open another record in the same tab: `openRecord(page, {table, sysId})` (src/sidepanel/openRecord.js). It picks the classic or
  the portal address for the page the agent is on, and never leaves the instance.

### Surfaces

Fulfillers work on the classic UI, Workspaces and portals (Service Portal, Employee Center, customer service portal). A record is
found from the form (classic), the URL (Workspace, portal) and Insert falls back to the DOM when there is no `g_form`. Nothing
may assume `g_form` or `g_user` exists.

## Additions from the review fixes

**Feature definition**
- `previewGroup: 'email'` (optional): features with the same group share ONE "check what will be sent" the first time (the six email
  drafts, the rewrite presets). Without it the feature id is the key.
- `insert.mode: 'replace'` (optional) replaces the field instead of adding below; a one-line field (a title) is always replaced.
  `insert.field` must be in `FILLABLE_FIELDS` (`src/lib/fillable.js`): a test walks the registry and fails when it is not.
  `insert.table` also decides where Insert is allowed (see above).
- `wave` is informational only (nothing reads it).

**ContextPack**
- `sensitive: true` marks a pack whose real class could not be resolved or is sensitive; it is minimised and HR-gated.
- `requirePreview: true` makes the preview show every time, even in "first time" mode. Set it on any pack that carries text about
  other people's tickets (reference material, linked incidents, an account's other cases, reports with ticket titles).
- `people[].role: 'reference_person'` names the people on the rows of reference material, so their names are masked precisely.
- `access[].status: 'blocked'` means the organisation's policy does not allow reading that table. It is never shown as "empty" or "denied".

**Policy at the read boundary** (`src/content/policyGuard.js`)
- A READ of a blocked table throws an error with `code: 'BLOCKED_TABLE'`; the readers turn it into an `access` entry with status `blocked`.
- The panel sends its normalised policy with every READ (`src/sidepanel/ask.js`); the content script merges it with the managed policy it
  reads itself. Lists are joined and HR content must be allowed by both: the panel can only make a read stricter.
- Optional `deps.isBlocked(table)` and `deps.sensitivePrefixes` exist on guarded deps for readers that need them.
- Policy keys added: `sensitiveTablePrefixes` (always includes `sn_hr_`), the HR endpoint rule (HR content needs `aiProvider` or `aiBaseUrl`
  pinned, or a local model), `tokenBudgetPerDay` is enforced, and `disabledFeatures` matches case-insensitively.

**FILL_FIELD** (`src/lib/messages.js`)
- `{ field, value, label, mode, expect } -> { ok, method?, label?, reason? }`. `expect` is `{ table, sysId }`, `{ table, newRecord: true }`
  or `{ email: true, table, sysId }`; a mismatch answers `reason: 'wrong-record'` and nothing is written. `label` in the answer is the
  box that was used (Workspace and portal).

**Part columns** (`src/features/partColumns.js`)
- Every derived part `field` (linked_incidents, child_tasks, account_cases, ...) is mapped to the ServiceNow columns it carries, so
  `blockedFields` refuses a part that carries a blocked column. A test fails when a part field exists that is not in the map.

## Additions from the second round (2026-10-30)

**Firewall and pipeline**
- `fw.buildRequest({ ..., mask: string[] })`: extra literals the person chose in the preview ("Mask this too"); everywhere one is written
  as a word of its own in the ticket data (any case; never inside a longer word, never in the fixed prompt) it gets a placeholder
  (`[PERSON_n]` when it looks like a name, otherwise `[MASKED_n]`). It can only add masking. `stats.counts.MANUAL` counts those places (a
  number only, for the audit). `maskMore` (src/lib/pipeline.js) answers `PART_OF_WORD` when the text is only inside longer words.
- A value the firewall masked once is masked again wherever it is written as a word of its own; a password, a credential, a card, an
  IBAN, an ID number or a phone number of 6 characters or more is masked inside a longer word too ("Welcome12", "ID4471234"). The
  final check (`verify`) follows the same rule (`placesOf` in src/pii/firewall.js), so it never refuses a place masking left alone.
- Invisible characters (src/lib/invisible.js: zero-width and bidi marks, invisible operators, variation selectors, the tag block, C1
  controls...) are removed before detection, so they cannot split an email or a number; ZWJ and ZWNJ stay in the text (some scripts
  need them) and the final high-confidence check looks through them too.
- Prose names are found by `src/pii/names.js` (`detectProseNames`): a cue before the name in Standard mode, also capitalised full
  names with no cue in Strict and Local-only. The fixed prompt text is never searched for names.
- `fw.rehydrate(text, { keep })` leaves the placeholder kinds in `keep` as they are; the pipeline passes `NEVER_REHYDRATE` (exported
  from `src/pii/firewall.js`: SECRET, CARD, IBAN, ID), so a password the model repeats never comes back into an answer.
- `prepareRun(...)` also returns `input` (what it was built from); `maskMore(prepared, text)` builds and seals again with one more
  literal and returns a new prepared run (the old one stands if that fails).
- `executeRun({ ..., signal })` passes the signal to the provider and returns `{ text, usage, truncated, notice }`; `notice` is the
  plain sentence for a cut-short answer. A cancelled request is audited as `cancelled`; other errors with their code.

**Providers** (`src/providers/http.js`)
- Every call goes through `requestJson`: time limit, at most 3 tries on 429/503/529 only, `AbortSignal`, and fixed fetch settings
  (`redirect: 'error'`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `cache: 'no-store'`) that a caller cannot loosen.
- Errors are `AiError` with a `code` (BAD_KEY, RATE_LIMIT, BUSY, TIMEOUT, CANCELLED, NO_CREDIT, CONTENT_FILTER, ...) and a short plain
  message; the audit records the code, never the message. Replies may carry `truncated: true`.
- Provider `azure`: resource address, API form (`v1` or classic with `api-version`) and deployment name; key in the `api-key` header.

**Features and prompts**
- `src/prompts/rules.js`: one wording per rule (untrusted data, language, customer-safe, only the asked-for text); `rulesFor(audience)`
  builds them into each prompt. Labels the parsers read stay in English. `tests/prompts-contract.test.js` pins each prompt to its parser.
- `insert.pick` on core features: `src/features/picks.js` (`pickRequesterQuestions`, `pickResolutionNotes`) so an agent-facing line
  ("Missing: ...", "Suggested close code: ...") is never inserted into a customer or close-notes field.
- Context spec key `times: { feature: [date columns] }`: the pack also carries those columns' STORED (UTC) values in
  `pack.related.times`, for a feature that compares them with note times or the clock (the email recommender).
- `SNIPPET_FEATURE` (`src/snippets/preview.js`) names the small `snippet-fill` spec used to fill snippet variables.

**Panel**
- Record tabs also receive `active` (true while shown), stay mounted per record (hidden when not shown) and each has its own error
  boundary. The Knowledge tools each have their own run.
- `ErrorNote` (`{ error, onRetry }`: plain text plus "Try again") and `AiKeyNote` (`{ eff, what }`: the no-key note plus "Open
  Settings") are the shared next-step components; use them instead of showing `err.message`.
- Tests that drive real views: `tests/fixtures/panel-dom-env.js` and `panel-dom.js` (a small DOM, a fake `chrome`, reads that can be
  held back, a fake AI fetch). AI actions in those tests go through the real `useRun` flow.

**Reports**
- The dashboard env carries `asOf` (one instant per load, so widgets ask identical, cacheable questions) and `maskMode` (the person's
  privacy mode). `maskTables(tables, { mode })` also masks names it finds in free-text cells.
- `aggregate(table, { ..., having })`: `having` is a count-only group filter (`count^<column>^<op>^<n>`), checked before any request.
- Report reads go through the content script's policy-guarded reads; Aggregate reads are checked with `isBlocked`, including
  dot-walked group-by columns.

**Policy and build**
- `effectiveSettings` returns `floors` (`piiMode`, `previewMode`): the person may choose stricter, never looser.
- `allowedProviders` (case-insensitive ids). `providedApiKey` is used only when `aiProvider` or `aiBaseUrl` is also pinned.
- `src/policy/baked.js` exports `BAKED_POLICY` (null in the normal build). The enterprise build replaces it with the config's policy,
  which `normalizePolicy` merges with the managed policy keeping the stricter side of each setting.
- The AI key lives in the IndexedDB vault `agentbuddy_vault` (store `keys`) on the extension's origin, not in `chrome.storage.local`.

**Content script**
- `src/content/barSync.js`: the bar asks the worker every 30 seconds whether it is on; a content script whose site was turned off
  retires (no bar, no answers to the panel).

## Additions from round 3 (2026-10-30)

The panel's structure and every plug-in point are in `docs/round3.md` (screens, Insights / AI Assist halves, work profiles, who owns
what). The contracts that cross areas:

- **Work profiles** (`src/profiles/profiles.js`): `shownFor(itemProfiles, eff)` decides what is shown (never what is allowed);
  `profilesOfFeature(feature)` (a feature may carry `profiles`), `screensFor(eff)`, `missingProfileFor(kind, eff)`, `aiAvailable(eff)`,
  `aiOffByPolicy(eff)`. Settings: `profiles`, `profilesConfirmed`, `showEverything`, `aiSkipped`, `halves`, `followUpDays`. Policy:
  `aiEnabled`, `disabledSections`, `allowedProfiles`, `lockedProfiles`, `orgSnippets`, `orgFormats`, `internalPhrases`, `defaultDashboard` (a saved
  layout file; `orgDashboard`, `offerOrgDashboard`, `addOrgDashboard` in `src/reports/dashboards.js`), `priorityAccounts` (account
  names; `isPriorityAccount` in `src/insights/priorityAccount.js`).
- **Feature fields** (read by the AI Assist action list and answer area): `group` ('understand' | 'reply' | 'work' | 'resolve'),
  `primary` ('copy' | 'insert'), `profiles`, `when(record, header)`.
- **Parts**: a part may carry `inline: true` (a short, one-line record column); the firewall then writes it as a `Label: value` line in
  one `<ticket_data field="fields">` block (`FIELDS_BLOCK`) placed where the first such part was. A part with a line break, or over 200
  characters, keeps its own block. Each inline part is masked and escaped on its own, and blocked fields and Strict are checked per part.
- **Rules**: the untrusted-data rule (`UNTRUSTED`, `src/prompts/rules.js`) is said once, in the firewall's `RULES_PREAMBLE`;
  `rulesFor(audience)` no longer includes it. `tests/prompts-contract.test.js` checks every request carries it exactly once, in the
  system message.
- **Text clean-up**: `cleanEmailText(text)` (`src/context/journal.js`) leaves out quoted email history, signatures, legal notices and
  mobile footers when parts are built; the pack and the views keep the whole text.
- **Pipeline** (`src/lib/pipeline.js`): `prepareRun` fits the request to the model (`fitToModel`: oldest notes first, the newest kept,
  the rules never cut; `config.contextTokens` overrides the model's assumed context) and returns `madeWithout` (`{ what, why, status }`,
  status denied | error | blocked | empty-or-hidden | skipped | cut; `madeWithoutText(list)` in `src/features/parts.js`) and `size`
  (`{ tokens, window, budget, source, notesLeftOut }`). New refusals: `TOO_LONG`; `MODE_TOO_LOW` for an HR record below Strict
  (every function). `requiredMode(feature, pack, policy, pageTable)` lets a view say "Needs Strict" before the click. Access entries may
  carry `more: true` (the journal was cut) and `reference: true` (a read made for reference material).
- **Answers** (`src/sidepanel/ticket/assist/answers/`): `useAnswers({ page, eff, record })` keeps answers per ticket in memory
  (`forgetAnswers()` clears them); every run still goes through `useRun`'s controller (`createRunController`).
- **Insert** (`src/sidepanel/insertFlow.js`): `insertTargets`, `insertText({ page, target, text, mode, source, pinned, review, force,
  send })` with `mode` 'replace' | 'append', `readFieldStates` / `applyFieldStates` (which fields the open form has), `primaryOf`,
  `choicesOf`, `insertsForKind`. Review options may carry `internalPhrases`.
- **Launches from the bar on the page** may name an Insights card: `card:<id>` (`QUICK_CARDS`, `src/features/quick.js`); the panel only
  brings that card forward.

## Additions from the audit fixes (2026-11-04)

- **Who is the customer** (`src/context/identity.js`): one place for every check that asks whether a note's author is the customer
  (resolution check, mood signals, email suggestions, missing information, email templates, the journey, steps that worked).
  `CUSTOMER_ROLES` (caller, requested_for, contact, consumer, opened_for, subject_person: the roles `src/context/people.js` produces),
  `foldWords` / `foldText` / `personKey` (Unicode letters and digits, so Arabic, Cyrillic and CJK names fold too; accents dropped;
  `personKey` sorts the words, so "Tuter, Abel" is "abel.tuter"), `customersOf`, `identities`, `authorRole` ('customer' | 'support' |
  'unknown'). An empty key is always 'unknown', never a match. Snippet variables pick the caller by the same roles.
- **Journal clocks**: when comments and work notes come from different sources (the `sys_journal_field` table, UTC; the record's display
  string, the reader's time zone), `src/context/journal.js` moves the local ones to UTC where it can pair entries; otherwise the journal
  access entry carries `localTimes: [type]` and `isLocalTime(entry, access)` says which clock an entry is on.
- **Text clean-up** (`src/context/util.js`): `cleanText` / `oneLine` take `{ html: true | 'auto' | false }` ('auto' strips HTML only
  when the value carries real markup, so "List<String>" stays); `journalText(value)` for comments, work notes and chat (entities decoded,
  tags stripped only from rich text); `plainText`, `looksLikeHtml`, `asText`. Every pattern is linear on hostile text.
- **Masking rules shared by masking and the final check**: `placesOf` in `src/pii/firewall.js` (see "Firewall and pipeline" above);
  invisible characters: `src/lib/invisible.js`.
- **The policy guard** (`src/content/policyGuard.js`): `DOT_WALK_TABLES` maps every reference column the code dot-walks to its target
  table(s); `walkTables(column)`; a new dot-walk must be added there (`tests/policy-hardening-dotwalk.test.js` scans `src/` for them).
  `checkRead(table, query, columns)` applies the guard to a read made another way (the reports' Aggregate API call). PAGE_STATE carries
  the panel's policy like READ (`pageStateMessage(policy)` in `src/lib/messages.js`).
- **Formats**: a person's `{ standard: true }` keeps the standard format over an unlocked organisation format (`resolveFormat` source
  'standard'); `orgFormatOf(id, org)` gives the organisation's format whatever is in force, so both editors can offer it back.
- **Storage changes worth a re-read**: `settingsChangeMatters(changes, area)` (`src/lib/settingsChanges.js`), used by the panel
  (`useEffective`) and Settings, each with a newest-read-wins counter.
- **The page bridge** (`src/page/bridge.js`) is versioned (`BRIDGE_VERSION`, pinned to the file by `tests/page-bridge-version.test.js`):
  raise it with every change, so an open page swaps the old bridge for the new one after an extension update.
