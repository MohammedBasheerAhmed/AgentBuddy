# Agent Buddy: deployment and managed policy

## Recommended profile for a security-approved rollout

| Setting | Value | Why |
|---|---|---|
| `allowedInstances` | your instances, e.g. `["https://acme.service-now.com", "https://acme-test.service-now.com"]` | People cannot turn it on for any other site. |
| `aiProvider` + `aiBaseUrl` | `openai` + your internal gateway, or `azure` + your Azure OpenAI resource address | One approved AI endpoint; people cannot point it elsewhere. |
| `allowedProviders` | only if you do not pin one provider: the vendors you approve, e.g. `["openai", "azure"]` | Rules out every other vendor (for example `deepseek`). People choose among these. |
| `allowedModels` | the models (for Azure: the deployment names) the organisation has approved | |
| `piiMode` | `strict` (or `local-only` with an internal model) | Raises the floor; people can only go stricter. |
| `previewMode` | `first` or `always` | People see exactly what leaves the browser. Also a floor: people may choose to see it more often. |
| `keyStorage` | `session` | The key is memory-only and cleared when the browser closes. Or supply the key through your gateway instead of per-person keys. |
| `allowHrContent` | `false` (default) | HR case free text is never sent. Setting it to `true` is not enough on its own: see "HR content" below. |
| `sensitiveTablePrefixes` | your own HR, legal or employee-relations table families, e.g. `["x_acme_hr_", "x_acme_legal_"]` | Treated like HR cases. `sn_hr_` is always included. |
| `disabledFeatures` | `["coaching-snapshot"]` until HR/works-council sign-off | Feature ids are not case-sensitive. The list is below. |
| `blockedTables` / `blockedFields` | tables or fields that must never be read or sent | See "Blocked tables and fields" below. Names are not case-sensitive. |
| `disablePageBar` | `true` if a bar drawn inside ServiceNow pages is not acceptable | Removes the small bar of main actions from ServiceNow pages for everyone (the side panel is unaffected). See "The bar on the page" in `docs/security.md`. |
| `tokenBudgetPerDay` | an agreed daily cap | Cost and abuse control. Counted per person on that computer; nothing is sent once it is reached. |

The same profile, ready to deploy, is in `docs/review-pack/policies/` (see "Policy files" below). For the strongest setup, use the
enterprise build (below): the instance and AI hosts and this policy are compiled into the extension, so the browser grants access to
those hosts only and the extension pages can connect to the AI endpoint only.

Choosing the AI endpoint is the decision a security team looks at first. Each provider in the list (Anthropic, OpenAI, Gemini, Mistral,
Groq, DeepSeek, OpenRouter) is a public service run by that vendor: the masked text goes to the vendor's servers, in whatever country
they are in. DeepSeek's own hosted API is operated from China, outside the EU and the US; check its current terms and your
organisation's rules on data residency before allowing it, or reach DeepSeek's models through a gateway or cloud region your
organisation already approves (`aiProvider: openai` plus `aiBaseUrl`), or run a model on the person's computer (Ollama). Where data
residency matters, pin the provider and the endpoint you approve with `aiProvider` and `aiBaseUrl` (people then cannot choose another),
or at least list the vendors you allow in `allowedProviders` so that any other vendor, DeepSeek's hosted API included, is refused.

All keys are optional and are described in `managed_schema.json`. A person can always choose a stricter option than the policy; never
a looser one. Locked settings show "Set by your organisation" in Settings.

## Every policy key

`tests/policy-keys.test.js` keeps this table, `managed_schema.json` and the code (`POLICY_KEYS` in `src/policy/policy.js`) in step.

| Key | Type | When not set | What it does |
|---|---|---|---|
| `allowedInstances` | list of text | any instance the person turns on | Only these ServiceNow sites can be turned on. An exact address whose host permission the browser already granted (force-installed with host access, or the enterprise build) is turned on by itself; a wildcard entry never is. Each entry is an exact https address (`https://acme.service-now.com`) or a wildcard with at least two names after `*.` (`*.corp.example.com`, which matches any sub-domain but not `corp.example.com` itself). An empty list, or one with no usable entry, allows no site. |
| `aiProvider` | text | the person chooses | The only AI provider allowed: `anthropic`, `openai` (OpenAI or a company gateway), `azure` (Azure OpenAI; see below), `gemini`, `mistral`, `groq`, `deepseek`, `openrouter`, `ollama` or `custom`. Not case-sensitive. A name the extension does not know allows nothing. |
| `aiBaseUrl` | text | the provider's own address, or what the person types | The only AI address allowed. https only (http only for `localhost` or `127.0.0.1`), no user name or password, no `?query` or `#fragment`. Compared in canonical form (lower-case host, no `:443`, no trailing slash). An address that is not valid blocks every AI call. |
| `allowedProviders` | list of text | any provider | The providers people may choose from (ids as for `aiProvider`, not case-sensitive), for example `["openai", "azure"]` to rule out every other vendor. A provider this version does not know never matches; an empty list allows none. When `aiProvider` is set it must be on the list. |
| `allowedModels` | list of text | any model | The only model ids (for Azure: deployment names) allowed; the first one is the default. Exact, case-sensitive. |
| `piiMode` | `standard`, `strict`, `local-only` | the person chooses (`standard` by default) | The lowest privacy mode allowed. People may choose a stricter one. |
| `previewMode` | `always`, `first`, `never` | the person chooses (`first` by default) | The least often the outgoing text is shown before it is sent. People may choose to see it more often. |
| `keyStorage` | `local`, `session`, `encrypted` | the person chooses (`local` by default) | Where the AI key is kept (see "Where the AI key is kept" below). Forced exactly. |
| `providedApiKey` | text | each person enters a key | A key supplied by the organisation; people never see or enter one. Used only when the same policy also pins `aiProvider` or `aiBaseUrl`, so it can never be sent to a provider a person picks; without a pin it is ignored. Anyone who can read the computer's policy store can read it, so prefer a gateway that authenticates people another way. |
| `disabledFeatures` | list of text | every feature on | Feature ids to switch off (list below). Not case-sensitive. |
| `blockedTables` | list of text | none | Tables that are never read or sent. Not case-sensitive. |
| `blockedFields` | list of text | none | Columns that are never sent, also when a part of the request carries them. Not case-sensitive. |
| `sensitiveTablePrefixes` | list of text | `sn_hr_` only | More table-name prefixes treated like HR cases. `sn_hr_` is always included. |
| `allowHrContent` | true / false | `false` | Allows HR case free text, together with a pinned endpoint (below). |
| `tokenBudgetPerDay` | whole number | no budget | Daily token budget per person on that computer. |
| `auditExport` | true / false | `true` | Allows exporting the local activity log as CSV. |
| `coachingEnabled` | true / false | `false` | Switches on the coaching snapshot (also needs Strict mode). |
| `disablePageBar` | true / false | `false` | Removes the bar of main actions from ServiceNow pages for everyone. |
| `aiEnabled` | true / false | `true` | `false` hides every AI Assist half and AI action for everyone; the Insights halves (no AI, nothing sent anywhere) stay. |
| `disabledSections` | list of text | every screen shows | Screens to hide for everyone: `mywork`, `team`, `write`, `knowledge`. The Ticket screen cannot be hidden. |
| `allowedProfiles` | list of text | every profile | Work profiles people may choose: `it`, `req`, `csm`, `hr`, `lead`, `km`, `mpc`. The `hr` profile is only offered when it is named here or `allowHrContent` is `true`. |
| `lockedProfiles` | list of text | people choose | Work profiles set for everyone (same ids as `allowedProfiles`); people cannot change them. |
| `orgSnippets` | list of objects | none | Canned replies for everyone, read-only in the panel: `{ "title", "body", "shortcut" }`, plain text, at most 200. |
| `orgFormats` | list of objects | every action's own format | How some AI actions write their answer, for everyone: `{ "feature", "sections", "style", "words", "extra", "locked" }` (see "Formats for AI answers" below), at most 40. |
| `internalPhrases` | list of text | the built-in list only | More words and phrases the safe-to-send check flags in customer-visible text (internal team or system names). |
| `defaultDashboard` | object | the ready-made dashboards only | One Team-screen dashboard for everyone: exactly what "Save layout as a file" writes for one dashboard (see "Organisation dashboard and priority accounts" below). People with no dashboards yet on an instance start with it, first and on show; anyone else gets "Add your organisation's dashboard" in the dashboard's ⋯ menu. Never locked. |
| `priorityAccounts` | list of text | no account is marked | Customer accounts marked "Priority account" on customer service cases (the Account card and the line at the top of the ticket), written as ServiceNow shows the account's name. At most 500 names of up to 100 characters. |

### How a policy value is read

- The browser checks each value against `managed_schema.json` first. A value of the wrong type, or a word that is not one of the allowed
  ones, is rejected there: it shows as an error on `chrome://policy` (or `edge://policy`) and has **no effect**, as if the key were not
  set. Check that page on one device before a rollout.
- Agent Buddy then ignores keys it does not know, ignores the values the browser let through but that make no sense (an allow-list entry
  that is not one https host, a prefix of one letter), and reads case and spaces generously where nothing else could be meant: `" Strict"`
  is `strict`, `OpenAI` is `openai`, `Reply-Draft` is `reply-draft`, `https://ACME.service-now.com:443/` is `https://acme.service-now.com`.
- Two cases block instead of being ignored, because ignoring them would loosen the policy: an `aiBaseUrl` that is not valid stops every
  AI call, and an `allowedInstances` list with no usable entry allows no site.
- `true`/`false` keys count only as a real true or false (a registry REG_DWORD 1 or 0 is converted by the browser).
- Check a policy file before deploying it: `node scripts/check-policy.js <file>` (a `.reg`, `.mobileconfig`, `.plist` or `.json` file)
  lists every key that would be ignored, read differently from how it is written, or that blocks AI calls, and prints the policy as
  Agent Buddy will read it. It exits with code 1 when something would not work as written.

### Formats for AI answers

```json
{
  "orgFormats": [
    {
      "feature": "record-summary",
      "sections": [
        { "name": "Issue", "hint": "what the person reports" },
        { "name": "Key actions performed", "hint": "what was done so far, in order" },
        { "name": "Next step" }
      ],
      "style": "lines",
      "words": 100,
      "locked": false
    },
    { "feature": "reply-draft", "extra": "Sign off with: Kind regards, the Service Desk.", "locked": true }
  ]
}
```

- Each entry names one AI action by its id (the ids are in "Feature ids" below) and any of: `sections` (a list of `{ "name", "hint" }`;
  only the ticket summary `record-summary`, the hand-off brief `handoff-brief` and the discussion catch-up `thread-summary` take
  them), `style` (`lines` or `bullets`), `words` (30 to 500) and `extra` (extra instructions, up to 600 characters; every listed
  action takes them). `locked: true` stops people changing that action; without it the format is the standard until a person saves their own.
- Actions whose answer the panel reads back (resolution notes, the hand-over note, the missing-details questions...) and actions the
  customer reads (the reply draft...) take `extra` only, so the labels the panel looks for stay as they are. `scripts/check-policy.js`
  lists every entry that would be ignored (an action that cannot be customised, an entry with nothing in it, the same action twice).
- **Actions that take `sections`, `style`, `words` and `extra`:** `record-summary`, `handoff-brief`, `thread-summary`.
  **Actions that take `extra` only:** `chat-summary`, `shift-handover`, `dashboard-insights`, `reply-draft`, `chat-reply`, `request-explain`,
  `missing-info`, `resolution-notes`, `resolution-improve`, `kb-article-draft`, `major-incident-comms`, `article-optimise`,
  `account-briefing`, `hr-case-brief`, `case-eng-escalation`, `problem-rca`, `change-cab-brief`.
- Nothing here can replace a whole prompt. The rules about facts, the customer-safe rules and the language rules are added after the
  format, and the firewall adds its own rule that the ticket data can never give orders. The text is sent as written (it is not masked,
  so it should hold no ticket details) and people see it in the check before sending, under "Rules sent with it".
- A team lead can build the format in Settings > AI Assist > "How AI answers are written" and press "Copy for your administrator": that
  puts the entry above on the clipboard, ready to paste into the policy.
- Two policies (a compiled-in one and the managed one): for an action both name, the managed one wins, and the action stays locked if
  either locks it.

### Organisation dashboard and priority accounts

```json
{
  "defaultDashboard": {
    "kind": "agentbuddy-dashboard-layout",
    "version": 1,
    "dashboard": {
      "name": "Service desk today",
      "scope": { "kind": "groups" },
      "widgets": [
        { "type": "section", "section": "overview" },
        { "type": "section", "section": "sla" },
        { "type": "section", "section": "workload", "params": { "staleDays": 5 } }
      ]
    }
  },
  "priorityAccounts": ["Boxeo", "Acme Corporation EMEA"]
}
```

- `defaultDashboard`: build the dashboard on the Team screen, choose "Save layout as a file" under Customize > More, and paste the
  file's contents as the value. It is read exactly like a file a person loads: unknown parts are left out, names are cut to 60
  characters, at most 24 widgets, and a value that is not such a layout (or holds no section this version knows) is ignored. The
  scope `groups` means each person's own groups; `chosen` names groups by sys_id, which only mean something on the instance they
  were saved on. A dashboard over every table has no `"tables"` in the file (files saved before 2026-10-31 wrote `"tables": null`
  there: delete that line, as the browser's policy check may refuse a `null`). In a Windows registry policy the value can also be the file's text as one string (`REG_SZ`).
- Nothing is locked: the organisation's dashboard becomes each person's own copy, which they can change, rename or remove. It is
  matched by its name, so someone who renamed or removed it is offered it again in the ⋯ menu. A ready-made dashboard with the
  same name gives way to it. An enterprise build can compile one in; a managed policy that sets its own replaces it.
- `priorityAccounts`: the account names exactly as the case's Account field shows them (case and spaces do not matter). ServiceNow
  has no standard "priority account" column, so this list is the only source; nothing more is read from ServiceNow for it. Names
  longer than 100 characters, values that are not text and names after the 500th are ignored (`node scripts/check-policy.js`
  lists each). The names compiled into an enterprise build and those in the managed policy are joined.

### Azure OpenAI

```json
{ "aiProvider": "azure", "aiBaseUrl": "https://contoso.openai.azure.com", "allowedModels": ["gpt-5-mini-prod"], "keyStorage": "session" }
```

- `aiBaseUrl` is the address of the Azure OpenAI resource (`https://<name>.openai.azure.com`), without `/openai/...`.
- `allowedModels` are the names of deployments created in that resource, not model names. Azure does not list a resource's deployments
  for an API key, so people type the deployment name in Settings; a name that is not on `allowedModels` is refused.
- The key (KEY 1 or KEY 2 of the resource, or `providedApiKey` together with this pin) is sent only in the `api-key` header, only to that
  resource; never as `Authorization: Bearer`.
- Agent Buddy uses the current v1 API form (`<resource>/openai/v1/chat/completions`, the deployment name in the body) by default. The
  classic form (`<resource>/openai/deployments/<deployment>/chat/completions?api-version=...`, default version `2024-10-21`) can be
  chosen in Settings.
- An Azure API Management gateway in front of the resource works as `aiBaseUrl` if it accepts the `api-key` header.

### Where the AI key is kept

- `local` (the default): in Agent Buddy's own database in this browser, an IndexedDB "vault" on the extension's origin. It is not in
  `chrome.storage.local`; ServiceNow pages and content scripts cannot open it.
- `session`: memory only, in `chrome.storage.session`, which Agent Buddy pins to trusted contexts (`TRUSTED_CONTEXTS`: extension pages
  only, never content scripts). Gone when the browser closes.
- `encrypted`: the vault holds the key encrypted with the person's passphrase (PBKDF2-SHA256, AES-256-GCM); it is unlocked for one
  browser session.
- `keyStorage` in the managed policy forces one of these, and an enterprise build can compile it in (`"keyStorage": "session"` in the
  config; a managed policy can then only move it to a stricter mode).

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
  Whether a browser lets a content script read `chrome.storage.managed` is **unverified** (docs/live-questions/policy.md). The side
  panel sends its own copy of the policy with every read, and the two are merged, so the read-time check works either way. Test it on
  one managed browser before you rely on it.
- `blockedFields` stops a request when a part of it IS the field or CARRIES it: the linked incidents of a problem carry
  `short_description` and `close_notes`; the SLA table carries its dates; reference tickets carry their category and close notes. The
  list of what each part carries is `src/features/partColumns.js`.
- A person's own daily limit in Settings and `tokenBudgetPerDay` both apply; the smaller one wins.

### Feature ids

`disabledFeatures` takes these ids (lower case; a capital letter does not matter). The id `reports` hides the whole Team section
(dashboards, reports, hand-over); the Team section's three AI features also have their own ids.

| Where | Ids |
|---|---|
| Actions on a record | `record-summary`, `reply-draft`, `resolution-notes`, `handoff-brief`, `missing-info`, `sentiment-risk`, `next-best-action`, `thread-summary`, `routing-hint`, `kb-article-draft`, `major-incident-comms`, `hr-case-brief`, `account-briefing`, `caller-briefing`, `case-eng-escalation`, `problem-rca`, `change-cab-brief`, `article-optimise`, `chat-summary`, `chat-reply` |
| Knowledge tools | `kb-merge-draft`, `kb-gap-outline` |
| Write: email drafts | `email-ask-info`, `email-status-update`, `email-resolution`, `email-approval-nudge`, `email-apology`, `email-closure` |
| Write: rewrite and notes | `rewrite-short`, `rewrite-friendly`, `rewrite-plain`, `rewrite-formal`, `rewrite-fix`, `rewrite-translate`, `rewrite-bilingual`, `notes-to-ticket` |
| Team (reports) | `reports` (the whole section), `shift-handover`, `dashboard-insights`, `coaching-snapshot` (off until `coachingEnabled` is `true`; needs Strict mode) |
| Record tabs | `request-explain`, `resolution-improve`, `fulfilment-checklist` |
| AI Assist on the ticket | `ask-ticket` (Ask about this ticket), `rewrite-own` (refine an answer with your own instruction) |

The deterministic tabs (Request, Check, Article, Duplicates, Gaps, Snippets and the lists) have no feature id: `disabledFeatures`
switches off their AI buttons only. Use `blockedTables` to stop what they read.

## Policy files for Chrome and Edge

Ready-made files with the recommended profile are in `docs/review-pack/policies/`. In each, replace `EXTENSION_ID` with the id shown at
`chrome://extensions` (or `edge://extensions`) for your build, and the example addresses with your own; then run
`node scripts/check-policy.js <file>`.

| File | Where it goes |
|---|---|
| `chrome-windows.reg` | Windows, Chrome: `HKLM\SOFTWARE\Policies\Google\Chrome\3rdparty\extensions\<EXTENSION_ID>\policy`. Lists are subkeys with values named `1`, `2`, ...; true/false and numbers are REG_DWORD. Also sets `ExtensionInstallForcelist`. Deploy with Group Policy Preferences, Intune or your usual tool. |
| `edge-windows.reg` | Windows, Edge: the same under `HKLM\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\<EXTENSION_ID>\policy`. |
| `chrome-macos.mobileconfig` | macOS, Chrome: a configuration profile for your MDM with a payload of type `com.google.Chrome.extensions.<EXTENSION_ID>` (the policy) and one of type `com.google.Chrome` (`ExtensionInstallForcelist`). Give the `PayloadUUID` values new UUIDs. |
| `edge-macos.mobileconfig` | macOS, Edge: the same with `com.microsoft.Edge.extensions.<EXTENSION_ID>` and `com.microsoft.Edge`. |
| `chrome-linux.json` | Linux, Chrome: copy to `/etc/opt/chrome/policies/managed/agentbuddy.json` (Chromium: `/etc/chromium/policies/managed/`). The policy sits under `"3rdparty": {"extensions": {"<EXTENSION_ID>": {...}}}`. |
| `edge-linux.json` | Linux, Edge: copy to `/etc/opt/edge/policies/managed/agentbuddy.json`. |
| `google-admin-console.json` | Chrome managed through the Google Admin console (also ChromeOS): Devices > Chrome > Apps & extensions, select Agent Buddy, "Policy for extensions"; each key is written as `{"Value": ...}`. |
| `recommended-policy.json` | The same values as a plain object, for reading and for tools that take one. |

These formats follow the browsers' published documentation for extension ("3rdparty") policy. They were checked by
`scripts/check-policy.js` and `tests/reviewpack.test.js`, **not yet on a managed device**: after deploying, open `chrome://policy` or
`edge://policy`, find Agent Buddy and check that every key shows the status OK.

The browser can also limit where any extension may act, independently of Agent Buddy's own policy: the `ExtensionSettings` policy with
`runtime_blocked_hosts` set to all sites and `runtime_allowed_hosts` set to your instances and AI host. It complements the enterprise
build's host list; its exact behaviour for requests from extension pages is **unverified** here, so test it on one device.

## Enterprise build: your hosts and policy compiled in

```
npm run build:enterprise -- enterprise/<name>.json        # writes dist-enterprise/
node build.js --enterprise enterprise/<name>.json --out <folder>
```

Copy `enterprise/example.json`, put in your instances, your AI endpoint and your policy, and build. The config uses the keys of the
table above, written exactly (lower case, canonical addresses), plus three build keys:

| Key | Required | Meaning |
|---|---|---|
| `allowedInstances` | yes | Exact https addresses of your instances. No wildcards, no paths. At most 50. |
| `aiProvider` | yes | One provider. |
| `aiBaseUrl` | for `azure` and `custom`; optional for `anthropic` and `openai` (their own API is used); for preset providers (Gemini, Mistral, Groq, DeepSeek, OpenRouter, Ollama) leave it out or write their fixed address | The AI address. https only, except `http://localhost` or `http://127.0.0.1` for a model on the person's computer. |
| any other policy key | no | Compiled in as written (see "What the compiled-in policy does"). |
| `label` | no | A short name shown next to the version (`version_name`), for example `Acme`. |
| `updateUrl` | no | The https address of your update manifest, for a self-hosted, force-installed build (`update_url` in the manifest). |
| `$comment` | no | Ignored. |

The build stops, with a message saying what to write instead, on anything else: an unknown key, a wrong type, an address that is not
canonical, a wildcard, plain http to anything but this computer, a feature id that does not exist, `piiMode: local-only` with an endpoint
that is not local, or `providedApiKey` (a key compiled into a build can be read by anyone who has the build; supply keys through the
managed policy or a gateway).

What differs from the normal build (only the manifest and one compiled-in file; the code is the same):

| | Normal build | Enterprise build |
|---|---|---|
| Host access | none at install; `optional_host_permissions` `https://*/*` and localhost, granted one host at a time when a person turns a site on | `host_permissions`: exactly your instances and your AI host; no optional hosts, so the extension cannot ask for any other site |
| Extension-page `connect-src` | `https: http://localhost:* http://127.0.0.1:*` | exactly the AI origin (for example `https://ai-gateway.corp.example`). The instances are not needed there: only the content script, inside the ServiceNow page, talks to them (`tests/readonly.test.js` enforces that) |
| Policy | the browser's managed policy only | the config's policy compiled in as a floor; the browser's managed policy can only make it stricter |
| Permissions, CSP otherwise, code | | unchanged |

Why `host_permissions` rather than optional hosts: the list is fixed by the organisation and exact, so it is granted at install
(silently when the browser force-installs the extension) and people see no permission prompt; and because no host is optional, the
extension can never request any other site. A person still turns Agent Buddy on for each instance once ("Turn on for this site" in the
side panel or Settings): the content script is registered only on the instances turned on, exactly as in the normal build. Someone
who restricts the extension's site access in the browser is asked again for that one site when they turn it on.

What the compiled-in policy does: it is applied as if it were a managed policy that is always present, and the browser's managed policy
is combined with it setting by setting, keeping the stricter side: allow-lists are intersected (instances, models), block-lists joined
(features, tables, fields, prefixes), `allowedProviders` keeps only the providers both allow, modes take the stricter value (for
`keyStorage`: `local`, then `encrypted`, then `session`), the smaller daily budget wins, `disablePageBar` holds if either
says so, and the switches that loosen something (`allowHrContent`, `coachingEnabled`, `auditExport`) hold only when BOTH allow it. So an
enterprise build that should allow HR content must say `"allowHrContent": true` in its config; the managed policy can still switch it
off. If the managed policy names a different AI provider or address than the build, or allows no model the build allows, no AI call is
made and the person is told to ask their administrator.

Check an enterprise build: the build prints the instances, the AI endpoint, `host_permissions` and `connect-src`; `npm run repro --
--enterprise enterprise/<name>.json` builds it twice and compares every file. Add `dist-enterprise/` to the files your version control
ignores.

## Self-hosted install: your own web server, installed and updated by policy

This is the route when Agent Buddy is not in the Chrome Web Store or the Edge Add-ons site. The browsers install it from an address
you control and check that address for new versions by themselves. `scripts/selfhost.js` makes the files; no other tool is needed.

**What you need first**

- Managed computers. Chrome and Edge install an extension from outside their store only when the computer is managed: Windows
  joined to a domain or enrolled in Intune (Group Policy or MDM), macOS enrolled in an MDM (a configuration profile), or any computer
  whose browser is enrolled in Chrome Browser Cloud Management / Edge management. On an unmanaged Windows or Mac the browser refuses
  it, whatever the files say. If an agent's computer is not managed, use the store or an unpacked pilot install instead.
- A web address, https only, with a certificate the browsers trust (an internal certificate authority must be trusted by the
  computers), for example `https://extensions.corp.example/agentbuddy/`. Any static file server will do. Only the `.crx` and
  `update.xml` go there; never the key.
- Chrome 116 or later (the manifest's minimum) and any current Edge.

**Once: the signing key**

```
node scripts/selfhost.js init          # writes selfhost/agentbuddy-key.pem and prints the extension id
```

The key decides the extension id (the id is derived from it) and who may publish an update: every installed copy accepts a package
signed with it. Back it up somewhere private (a password manager, a vault), keep it off the web server and out of the repository
(`selfhost/` and `*.pem` are ignored). Lose it and the id changes: every computer would have to install it again. Two people should
be able to find it.

**Every release**

1. Raise `version` in `manifest.json` and `package.json` (the browsers update only to a higher version).
2. Build: `npm run build` (the normal build) or `npm run build:enterprise -- enterprise/<name>.json` (your hosts and policy compiled in; its
   `updateUrl` is the address of `update.xml` below).
3. Pack: `node scripts/selfhost.js pack --base-url https://extensions.corp.example/agentbuddy --dist dist-enterprise` (or
   `--dist dist`, or `--dist release/unpacked` for the minified build `npm run package -- --minify` makes). Without `--dist` it packs
   whichever of `dist-enterprise/` and `dist/` holds a build, and stops when both do; it prints which build it packed and when it was
   built. It writes `selfhost/out/`:
   `agentbuddy-<version>.crx` (the signed package), `update.xml` (what the browsers poll), `policies/` (the policy files of
   `docs/review-pack/policies/` with your extension id and update address filled in), and `SHA256SUMS`.
4. Upload the `.crx` and `update.xml` to the address. Keep the older `.crx` files there for a while.
5. The first time only: deploy the policy files (below). After that, browsers find the new version within hours (Chrome checks about
   every five hours; `chrome://extensions` > Update forces it, `edge://extensions` the same).

**Deploying the policy** (from `selfhost/out/policies/`, see "Policy files for Chrome and Edge" for what each file is)

| Computers | Use |
|---|---|
| Windows, Chrome or Edge | `chrome-windows.reg` / `edge-windows.reg`: Group Policy Preferences, Intune, or any registry deployment. |
| macOS, Chrome or Edge | `chrome-macos.mobileconfig` / `edge-macos.mobileconfig` through your MDM. |
| Chrome Browser Cloud Management or Google Admin | `google-admin-console.json` and the force-install entry `<id>;<address of update.xml>`. |

Each file already holds the line that installs Agent Buddy (`ExtensionInstallForcelist`) next to the recommended Agent Buddy policy.

**Check it**: on one computer open `chrome://policy` (or `edge://policy`) and press Reload policies; open `chrome://extensions`: Agent
Buddy is there, "Installed by your administrator", with the id you were given. Then `node scripts/selfhost.js verify <file.crx>`
shows the same id for the package you uploaded. Pilot with a few agents before everyone.

**What was and was not verified here**: the package was compared with one that Chrome's own `--pack-extension` made from the same folder
and key (same header size and layout; both verify and give the same id) and `tests/selfhost.test.js` checks the signature and the id.
The install on a managed computer and the update poll were **not** tried: do that with the pilot above and tell us what the browser
says if it refuses.

## Installing for everyone

1. Build: `npm ci && npm run build` (or the enterprise build above). The `dist/` (or `dist-enterprise/`) folder is the extension.
2. Pilot: load the folder unpacked in a test profile. Record the SHA-256 list of the files (`npm run repro -- --write SHA256SUMS`).
3. Rollout: publish through the organisation's controlled channel. Either a private/unlisted store listing, or force-install with
   `ExtensionInstallForcelist` pointing at a self-hosted update manifest (the samples above include it). Pin the version; review each
   update.
4. Browser access to a site: in the normal build the person grants it per site when they turn Agent Buddy on (the manifest declares no
   static host permissions). In the enterprise build access to your hosts is granted at install and no other site can be requested.

## What to tell the security team

See `docs/review-pack/README.md` (how to build from source, verify hashes and run the tests), `docs/security.md` (controls, limits,
threat model) and the tests that enforce each claim (`npm test`). The three tests to read first: `tests/manifest.test.js` (permission
snapshot), `tests/readonly.test.js` (no writes to ServiceNow), `tests/seal.test.js` (nothing reaches the AI without the PII firewall).
