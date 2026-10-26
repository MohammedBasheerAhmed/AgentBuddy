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
