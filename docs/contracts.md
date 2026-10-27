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

## Extension points (how a feature is added without touching shared files)

Each area has its own files; add yours, do not edit another area's.

### Feature definition (`src/features/packs/<area>.js`, `export default [ ... ]`)

```js
{
  id: 'sentiment-risk',              // unique; also what policy `disabledFeatures` names
  title, description,                // shown on the Actions button
  wave: 1 | 2 | 3,
  kinds: ['incident', ...],          // record kinds whose Actions list shows it. [] = not on the Actions list (a report or
                                     // compose feature that a view runs itself)
  context: 'record-summary',         // optional: the context spec (allowlist) to read the pack with; default = id
  journal: 15,                       // how many notes/comments go into the parts
  parts: (pack) => [{label, field, text}],   // optional: custom parts (default packToParts(pack, {journal}))
  insert: { field, label, fieldLabel, pick? } | [ ... ] | omitted,   // omitted = Copy only. pick(plainText) chooses the part
                                     // of the answer this button inserts. Customer-visible fields (comments, close_notes)
                                     // get the safe-to-send check first.
  system: '...',                     // the task for the model. No ticket data in it, ever.
  instruction: '...',
  requires: { minMode: 'strict' },   // optional: refuse unless the person's privacy mode is at least this (standard < strict < local-only)
  defaultOff: true,                  // optional: off until the organisation's policy turns coaching on (coachingEnabled)
}
```

Everything an AI feature sends goes through `prepareRun` (policy, firewall, seal) and `executeRun` (provider, audit) in
src/lib/pipeline.js. Views never call `sendChat` themselves; they use `useRun()` (src/sidepanel/useRun.js).

### Context specs (`src/context/specs/<area>.js`)

```js
export default {
  spec:    { 'sentiment-risk': { common: [columns...], by: { incident: [columns...] } } },   // what that feature may READ
  journal: { 'sentiment-risk': true },                                                       // read notes and comments?
  related: { 'sentiment-risk': ['slas', 'approvals'] },                                      // which extras (related.js)
  fieldsByKind: { knowledge: [columns...] },                                                 // display ceiling for a new kind
};
```

A column outside the ceiling (`FIELDS_BY_KIND`) can never be read; `spec` is intersected with it. Add a column only with a reason.

### READ operations (`src/content/ops/<area>.js`)

```js
export default { opName: async (args, { deps, checkRecord, checkPack }) => plainJson };
```

GET-only through the context engine or src/content/tableApi.js; validate every argument (identifiers with `isIdentifier`, sys_ids with
`SYS_ID_RE`); never return more than the person's own session could read. The panel calls it with `read(tabId, 'opName', args)`
(src/sidepanel/ask.js).

### Panel sections and record tabs

- Top-level sections (src/sidepanel/App.jsx): This page, My day, Team (`tabs/ReportsView.jsx`), Write (`tabs/ComposeView.jsx`),
  Knowledge (`tabs/KnowledgeToolsView.jsx`). Props `{ page, eff }`. They work from any page of an enabled site.
- Record tabs (src/sidepanel/recordTabs.js): extra tabs on a record for given kinds. Props `{ page, eff, record, header, run, aiReady }`.
- `page` carries `{ tabId, href, surface: 'classic'|'workspace'|'portal'|'other', record, newRecord: {table, kind}|null, user }`.
- To run AI: `const run = useRun({ page, eff, record })`, then `run.run(feature, { getPack })` and render `<RunPanel run={run} eff page />`.
  A view that is not about one record builds a ContextPack-shaped object in `getPack` (its text goes through the firewall like any other).
- To open another record in the same tab: `openRecord(page, {table, sysId})` (src/sidepanel/openRecord.js). It picks the classic or
  the portal address for the page the agent is on, and never leaves the instance.

### Surfaces

Fulfillers work on the classic UI, Workspaces and portals (Service Portal, Employee Center, customer service portal). A record is
found from the form (classic), the URL (Workspace, portal) and Insert falls back to the DOM when there is no `g_form`. Nothing
may assume `g_form` or `g_user` exists.
