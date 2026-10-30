# Data protection impact assessment (DPIA): Agent Buddy

A template. What Agent Buddy itself does is filled in; what depends on your organisation is marked **[to fill]**. The technical facts
come from `docs/security.md` (controls, limits) and `docs/deployment.md` (policy). Version of the extension assessed: **[to fill, e.g.
0.1.0 and the SHA-256 list of the build]**.

## 1. The processing

| | |
|---|---|
| What | A browser extension for ServiceNow fulfillers and team leads. It reads the ticket the person has open, with their own ServiceNow session, masks personal data, and asks an AI model for a summary, a reply draft, resolution notes and similar. The person reads the answer and may insert it into one field of the open form; they press Save themselves. |
| Who uses it | **[to fill: teams, number of people]** Fulfillers (IT, customer service, HR, catalog) and their team leads. No ServiceNow admin role is needed or used. |
| Controller | **[to fill: your organisation]** |
| Processors | The AI provider your organisation chooses: **[to fill: provider, contract, region]**. Agent Buddy has no server and no vendor that receives data. ServiceNow is already your processor for the ticket data. |
| Systems | The person's browser (Chrome or Edge, managed), your ServiceNow instance(s) **[to fill]**, the AI endpoint **[to fill: e.g. an internal gateway]**. |

## 2. Data categories

| Category | Read from ServiceNow | Sent to the AI provider | Kept by Agent Buddy |
|---|---|---|---|
| Ticket fields (short description, description, notes, comments, resolution, category, state) | Yes, only the columns the action needs (field allowlists per action and record type) | Yes, after masking | No |
| Names of people on the record (caller, assignee, journal authors, people on related tickets) | Yes, to mask them | No: replaced by placeholders such as `[PERSON_1]` | No |
| Email addresses, phone numbers, ID and card numbers, secrets found in the text | Inside ticket text | No: masked by pattern | No |
| Names written inside sentences that are on no column of the record | Inside ticket text | **May pass** (limit 1 and 8 in `docs/security.md`); the preview shows the exact text | No |
| HR case content (special category data) | Only free text and identities when policy `allowHrContent` is true | Only when `allowHrContent` is true AND the policy pins the AI endpoint, or the model runs on the computer | No |
| Settings, the AI key, snippets, usage counts | | The key, to its own provider only | Yes, in the browser (`docs/security.md`, "Stored data") |
| Audit log | | No | Yes: action, table, a salted hash of the record id, provider and model, counts of masked items, outcome. No content. Up to 1000 entries, on the person's computer |

## 3. Purposes and legal basis

| Purpose | Legal basis **[to fill]** |
|---|---|
| Help the person handle tickets they are already assigned to or allowed to see (summaries, drafts, notes) | **[to fill, e.g. legitimate interest; employment contract]** |
| Team views for team leads (counts, workload, hand-over) | **[to fill]** |
| Coaching snapshot (off unless policy `coachingEnabled` is true; needs Strict mode) | **[to fill; consult the works council]** |

## 4. Data subjects

Requesters and callers (employees, customers, consumers), the people named in tickets, the agents who work on them, and their team
leads. **[to fill: whether customers outside the organisation are included]**

## 5. Recipients and transfers

- The AI provider chosen in policy (`aiProvider`, `aiBaseUrl`). It receives masked text and the AI key. Country: **[to fill]**. Transfer
  mechanism: **[to fill]**. Its retention of prompts and answers: **[to fill from the contract]** (limit 5).
- No one else. Agent Buddy has no server, no analytics and no telemetry (`docs/security.md` section 2; enforced by
  `tests/readonly.test.js` and the manifest CSP).

## 6. Retention

| Where | What | How long |
|---|---|---|
| ServiceNow | The ticket, and any text the person chose to insert and save | Your ServiceNow retention **[to fill]** |
| AI provider | Masked prompts and answers | Per contract **[to fill]** |
| Browser | Settings, key, snippets, usage and audit logs (no ticket content) | Until the person clears them (Settings, "Clear everything stored by Agent Buddy") or the extension is removed. The audit log keeps the last 1000 entries. Checklist ticks and a key in "memory only" mode go when the browser closes |
| Browser memory | Ticket data while an action runs | Cleared on refresh; never written to storage |

## 7. Rights of data subjects

- Access, rectification, erasure: the data lives in ServiceNow and is handled there as today. Agent Buddy keeps no copy of ticket content.
- At the AI provider: per contract **[to fill: how a request reaches the provider, whether it keeps anything]**.
- Objection to automated decision-making: Agent Buddy makes no decision; a person reads every draft and decides whether to use it.

## 8. Risks and measures

The full list, with the test that enforces each measure, is `stride.md` (this folder). The ones that matter most here:

| Risk | Measure | Remaining |
|---|---|---|
| Personal data reaches the AI provider | PII firewall, field allowlists, preview (policy can force `always`), Strict or Local-only mode | Names in prose (limits 1, 8) |
| Special category data (HR) | Off by default; needs `allowHrContent` and a pinned endpoint | Custom HR tables need `sensitiveTablePrefixes` (limit 9) |
| Provider retention or reuse | **[to fill: contract terms, zero-retention option]** | |
| Over-use or misuse by a person | Audit log, daily token budget, disabled features | The log is local (STRIDE R1) |

## 9. Necessity and proportionality

**[to fill]** Consider: only tickets the person can already see are read; only the columns each action needs; nothing is stored; the
organisation can switch off any action (`disabledFeatures`), block tables and fields, and choose a model that runs on the computer.

## 10. Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Data protection officer | **[to fill]** | | |
| Security team | **[to fill]** | | |
| Works council (if coaching or team views are used) | **[to fill]** | | |
| Service owner | **[to fill]** | | |
