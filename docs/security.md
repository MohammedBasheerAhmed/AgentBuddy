# Agent Buddy: security and privacy review pack (draft)

Status: draft for the security team. Every claim that a test enforces names the test. Anything not yet verified on a real
instance is marked **unverified**. Version 0.1.0.

## 1. What it is

A Chrome/Edge extension for ServiceNow fulfillers (IT, customer service, HR cases, catalog) and their team leads. It reads
the ticket the person already has open, masks personal data, asks an AI model of the organisation's choice for a summary,
reply draft, resolution notes and similar, and lets the person insert the result into the open form. It has no server, no
account, no analytics.

## 2. Data flow

```
ServiceNow page (user already signed in)
   |  content script: GET-only reads with the user's own session (ACLs apply)
   v
Side panel (extension page)
   |  PII firewall: detect -> replace with [PLACEHOLDERS] -> seal -> (preview, user confirms)
   v
AI endpoint chosen by the person or the organisation   <- the ONLY other network destination
   |  response
   v
Side panel: placeholders replaced with the real values locally; shown as plain text; Insert fills one form field
```

Destinations: (1) the user's own ServiceNow instance, (2) the AI endpoint. Nothing else. No vendor server exists.

## 3. Permissions and justification

| Permission | Why | Enforced by |
|---|---|---|
| `storage` | Settings, snippets, key (per chosen mode), local audit log | manifest test |
| `sidePanel` | The panel is the only UI | manifest test |
| `scripting` | Register the content script only on instances the person enabled | manifest test |
| `activeTab` | See the address of the tab the person clicked the button on, so "Turn on for this site" knows which site | manifest test |
| optional hosts `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Never granted wholesale. The browser asks for ONE host at a time: an instance or the AI address. Localhost is for a local model. | `tests/manifest.test.js` |

Not requested: `tabs`, `history`, `cookies`, `webRequest`, `debugger`, `downloads`, `clipboardRead`, `nativeMessaging`, static
host permissions, static content scripts, `web_accessible_resources`, `externally_connectable`, keyboard commands.
(`tests/manifest.test.js` fails if any of these appear.)

Extension-page CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src https:
http://localhost:* http://127.0.0.1:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. No `unsafe-eval`, no
`unsafe-inline`, no remote scripts. `connect-src https:` is broad because the AI address is chosen by the organisation;
the real gate is the per-host browser permission above. An enterprise build can bake an exact list (planned).

## 4. Controls

| Concern | Control | Test |
|---|---|---|
| Writes to ServiceNow | None through the API. The instance client refuses every method except GET. "Insert" fills one field on the open form; the person presses Save, so ACLs, business rules and the audit trail apply. The page bridge has no save, no network, no eval. | `tests/readonly.test.js` |
| Personal data to the AI | Every request goes through the PII firewall; the provider dispatcher refuses any request that was not sealed by it. Only the firewall module can seal. | `tests/seal.test.js`, `tests/pii-*.test.js` |
| Visibility | A preview shows the exact outgoing text with masked values highlighted, configurable always / first time / never (policy can force). | `tests/pipeline.test.js` |
| Data minimisation | Each feature has a field allowlist per record kind; whole records are never read or sent. HR free text is excluded unless policy allows it. | `tests/context-*.test.js` |
| Prompt injection | Ticket text is wrapped as untrusted data; the model gets no tools and cannot act; output is plain text. | `tests/pii-*.test.js` |
| Exfiltration through output | Output is rendered by a plain-text parser: no HTML, no images, no loading links. Markdown image syntax is shown as text. | `tests/render-*.test.js` |
| Customer-visible text | A safe-to-send check scans text before it is inserted into a customer-visible field. | `tests/safesend*.test.js` |
| Key handling | The key is only read by extension pages, never by content scripts or the page; sent only to its own provider. Modes: browser storage (default), memory-only, passphrase-encrypted (PBKDF2 + AES-GCM). Policy can force a mode or supply the key. | `tests/keystore.test.js`, `tests/policy.test.js` |
| Organisation control | `chrome.storage.managed` policy: allowed instances, AI endpoint and models, privacy mode floor, preview mode, key storage, disabled features, blocked tables and fields, HR switch, token budget. Users can tighten, never loosen. | `tests/policy.test.js` |
| Accountability | Local audit log: feature, table, salted record hash, provider/model, counts of masked items, tokens, outcome. It never holds content. CSV export. | `tests/audit.test.js`, `tests/pipeline.test.js` |
| Cost / abuse | Daily call/token caps and a usage log, per provider. | inherited from NowBuddy, unit-tested there |
| Supply chain | One runtime dependency family (React). No remote code, no CDN. Bundled with esbuild, no source maps shipped. SBOM and lockfile in the repo. | `npm ls`, `package-lock.json` |

## 5. Known limits (stated plainly)

1. **Names written inside sentences can be missed.** Pattern detection reliably finds emails, phone numbers, card and ID
   numbers, secrets. Names are masked precisely when they are on the record (caller, assignee, journal authors) but a third
   party's name typed in prose may pass. Mitigations: the preview, strict mode, a local model.
2. **Default key storage is browser storage.** Anyone or any malware that can read the browser profile can read the key.
   Recommended for an approved rollout: policy `keyStorage = session`, or a gateway that issues short-lived keys.
3. **The page can see the bridge events.** A script on the ServiceNow page can observe or forge the bridge's answers; they
   are treated as data to check, never as authority. A hostile page script could already read the same form.
4. **Workspace forms** use shadow DOM, so "Insert" may fall back to Copy there. **Unverified** on a real Workspace.
5. **The AI provider sees the masked text.** The organisation's contract with that provider governs retention.
6. **`connect-src https:`** (see section 3).

## 6. Threat model summary

| Threat | Outcome |
|---|---|
| Malicious ticket text tries to steer the model | No tools, no actions, plain-text output; worst case is a misleading draft the person reads before using. |
| Model output tries to leak data through an image or link | Not rendered; shown as text. |
| Compromised page script | Can read what the page already has; cannot reach the AI key (extension pages only) or write through the extension. |
| Stolen AI key | Limited by the provider-side spend cap and by sending only to its own host; mode and policy options above. |
| Malicious update | Distribution through the organisation's controlled channel (private/unlisted store listing or force-install with a self-hosted update URL); build is reproducible from source. |
| Over-collection | Field allowlists, HR free text off by default, tables and fields blockable by policy. |

## 7. Still to deliver for the full review pack

Data-flow diagram (image), STRIDE table with owners, DPIA template, sample managed-policy JSON for Chrome and Edge,
SBOM export, results of a test run on a real instance as a non-admin user, enterprise build with baked-in hosts.
