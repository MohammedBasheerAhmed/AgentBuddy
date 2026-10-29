# Agent Buddy: deployment and managed policy

## Recommended profile for a security-approved rollout

| Setting | Value | Why |
|---|---|---|
| `allowedInstances` | your instances, e.g. `["https://acme.service-now.com", "https://acme-test.service-now.com"]` | People cannot turn it on for any other site. |
| `aiProvider` + `aiBaseUrl` | `openai` + your internal gateway or Azure OpenAI address | One approved AI endpoint; people cannot point it elsewhere. |
| `allowedModels` | the models the organisation has approved | |
| `piiMode` | `strict` (or `local-only` with an internal model) | Raises the floor; people can only go stricter. |
| `previewMode` | `first` or `always` | People see exactly what leaves the browser. |
| `keyStorage` | `session` | The key is memory-only and cleared when the browser closes. Or supply the key through your gateway instead of per-person keys. |
| `allowHrContent` | `false` (default) | HR case free text is never sent. Setting it to `true` is not enough on its own: see "HR content" below. |
| `sensitiveTablePrefixes` | your own HR, legal or employee-relations table families, e.g. `["x_acme_hr_", "x_acme_legal_"]` | Treated like HR cases. `sn_hr_` is always included. |
| `disabledFeatures` | `["coaching-snapshot"]` until HR/works-council sign-off | Feature ids are not case-sensitive. The list is below. |
| `blockedTables` / `blockedFields` | tables or fields that must never be read or sent | See "Blocked tables and fields" below. Names are not case-sensitive. |
| `disablePageBar` | `true` if a bar drawn inside ServiceNow pages is not acceptable | Removes the small bar of main actions from ServiceNow pages for everyone (the side panel is unaffected). See "The bar on the page" in `docs/security.md`. |
| `tokenBudgetPerDay` | an agreed daily cap | Cost and abuse control. Counted per person on that computer; nothing is sent once it is reached. |

Choosing the AI endpoint is the decision a security team looks at first. Each provider in the list (Anthropic, OpenAI, Gemini, Mistral,
Groq, DeepSeek, OpenRouter) is a public service run by that vendor: the masked text goes to the vendor's servers, in whatever country
they are in. DeepSeek's own hosted API is operated from China; check its current terms and your organisation's rules on data
residency before allowing it, or reach DeepSeek's models through a gateway or cloud region your organisation already approves
(`aiProvider: openai` plus `aiBaseUrl`), or run a model on the person's computer (Ollama). Pin the one you approve with `aiProvider` and
`aiBaseUrl`; people then cannot choose another.

All keys are optional and are described in `managed_schema.json`. A person can always choose a stricter option than the policy; never
a looser one. Locked settings show "Set by your organisation" in Settings.

### HR content

HR text is sent to an AI only when ALL of these hold: the record is in an HR-family table (`sn_hr_*` or a prefix in
`sensitiveTablePrefixes`, or a record opened as the base class `task` whose real class is one of those, or whose class could not be
looked up); `allowHrContent` is `true`; and the policy pins the AI endpoint (`aiProvider` or `aiBaseUrl` is set) or the model runs on
the person's computer (Ollama and similar). Otherwise the run is refused with a message that tells the person to ask their
administrator. Pin BOTH `aiProvider` and `aiBaseUrl` for HR: `aiProvider: openai` on its own still allows the public OpenAI address.
The HR case brief also needs Strict (or Local-only) privacy mode.

### Blocked tables and fields

- `blockedTables` is enforced where data is read. The content script reads the managed policy (it checks again every 30 seconds) and
  refuses to read a blocked table: the record, its related lists, the table a request-form answer points at, the journal of a record
  of that table, and tasks of that class. The panel says "Your organisation does not allow Agent Buddy to read X records". The
  AI run is refused as well (`TABLE_BLOCKED`), for the record's table and for the table of the form the person is on.
  Whether a browser lets a content script read `chrome.storage.managed` is **unverified** (docs/live-questions/policy.md). If it
  does not, the read-time check does nothing and only the AI-run check applies. Test this on one managed browser before you rely on it.
- `blockedFields` stops a request when a part of it IS the field or CARRIES it: the linked incidents of a problem carry
  `short_description` and `close_notes`; the SLA table carries its dates; reference tickets carry their category and close notes. The
  list of what each part carries is `src/features/partColumns.js`.
- A person's own daily limit in Settings and `tokenBudgetPerDay` both apply; the smaller one wins.

### Feature ids

`disabledFeatures` takes these ids (lower case; a capital letter does not matter). The id `reports` hides the whole Team section
(dashboards, reports, hand-over); the Team section's three AI features also have their own ids.

| Where | Ids |
|---|---|
| Actions on a record | `record-summary`, `reply-draft`, `resolution-notes`, `handoff-brief`, `missing-info`, `sentiment-risk`, `next-best-action`, `thread-summary`, `routing-hint`, `kb-article-draft`, `major-incident-comms`, `hr-case-brief`, `account-briefing`, `case-eng-escalation`, `problem-rca`, `change-cab-brief`, `article-optimise`, `chat-summary`, `chat-reply` |
| Knowledge tools | `kb-merge-draft`, `kb-gap-outline` |
| Write: email drafts | `email-ask-info`, `email-status-update`, `email-resolution`, `email-approval-nudge`, `email-apology`, `email-closure` |
| Write: rewrite and notes | `rewrite-short`, `rewrite-friendly`, `rewrite-plain`, `rewrite-formal`, `rewrite-fix`, `rewrite-translate`, `rewrite-bilingual`, `notes-to-ticket` |
| Team (reports) | `reports` (the whole section), `shift-handover`, `dashboard-insights`, `coaching-snapshot` (off until `coachingEnabled` is `true`; needs Strict mode) |
| Record tabs | `request-explain`, `resolution-improve`, `fulfilment-checklist` |

The deterministic tabs (Request, Check, Article, Duplicates, Gaps, Snippets and the lists) have no feature id: `disabledFeatures`
switches off their AI buttons only. Use `blockedTables` to stop what they read.

## Chrome and Edge policy samples

Replace `<EXTENSION_ID>` with the id shown at `chrome://extensions` (or `edge://extensions`) for your installed build.

Windows registry (Chrome): `HKLM\SOFTWARE\Policies\Google\Chrome\3rdparty\extensions\<EXTENSION_ID>\policy`
Windows registry (Edge): `HKLM\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\<EXTENSION_ID>\policy`

macOS / Linux managed-policy file (Chrome: `/etc/opt/chrome/policies/managed/agentbuddy.json`):

```json
{
  "3rdparty": {
    "extensions": {
      "<EXTENSION_ID>": {
        "allowedInstances": ["https://acme.service-now.com"],
        "aiProvider": "openai",
        "aiBaseUrl": "https://ai-gateway.corp.example/v1",
        "allowedModels": ["gpt-5-mini"],
        "piiMode": "strict",
        "previewMode": "first",
        "keyStorage": "session",
        "allowHrContent": false,
        "disabledFeatures": ["coaching-snapshot"],
        "blockedTables": [],
        "blockedFields": [],
        "sensitiveTablePrefixes": ["x_acme_hr_"],
        "tokenBudgetPerDay": 200000,
        "auditExport": true,
        "disablePageBar": false
      }
    }
  }
}
```

## Installing for everyone

1. Build: `npm ci && npm run build`. The `dist/` folder is the extension.
2. Pilot: load `dist/` unpacked in a test profile.
3. Rollout: publish through the organisation's controlled channel. Either a private/unlisted store listing, or force-install with
   `ExtensionInstallForcelist` pointing at a self-hosted update manifest. Pin the version; review each update.
4. Browser access to a site is still granted per site by the person (or the browser's own enterprise rules): the manifest declares
   no static host permissions. A build that bakes in your instance hosts so no prompt appears is planned.

## What to tell the security team

See `docs/security.md` (controls, limits, threat model) and the tests that enforce each claim (`npm test`). The three tests to read
first: `tests/manifest.test.js` (permission snapshot), `tests/readonly.test.js` (no writes to ServiceNow), `tests/seal.test.js`
(nothing reaches the AI without the PII firewall).
