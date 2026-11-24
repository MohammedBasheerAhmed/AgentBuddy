# AgentBuddy: Leadership Overview

Nov 24, 2026

> This is the repo copy of the leadership page prepared for Confluence. It is a snapshot of the draft written on 2026-11-24 from the code and the docs, not from a live instance. Anything marked "not verified" in the guide has not yet been checked on a real ServiceNow instance.

## What it is

AgentBuddy is a browser extension that helps ServiceNow fulfillers and their team leads work tickets faster. It reads the ticket the person already has open, hides personal data, asks an AI model the organisation chose, and fills the answer into the form for the person to review and save. It needs no admin role, no ServiceNow plugin, no extra ServiceNow licence, and no server of ours.

**The problem.** Agents lose time reading long threads, hunting for earlier fixes, typing replies and writing close notes. Team leads cannot see queue health without building reports. ServiceNow's own AI summaries sit in the Pro Plus tiers, which many organisations do not license.

**The promise in one line.** Nothing is written to ServiceNow by the extension, personal data is masked before any AI call, and the only places data goes are the organisation's own ServiceNow and its own AI endpoint.

| Fact | Value |
| --- | --- |
| Version | 0.1.0, built on 2026-11-22 (round 5) |
| Browsers | Chrome and Edge (one package), Firefox 128 or later; Safari planned |
| Works on | ServiceNow classic UI, Workspaces, Service Portal, Employee Center, customer service and HR portals |
| Record kinds | Incident, problem, change, request and requested item, catalog task, customer case, HR case |
| AI | Any key: Azure OpenAI, OpenAI or a company gateway, Anthropic, Gemini, Mistral, Groq, DeepSeek, OpenRouter, or a local model (Ollama) |
| Languages | English and Arabic (right to left), 3,533 Arabic texts |

## Who it is most useful for

It is built for people who work tickets every day with normal roles, not for ServiceNow developers or admins. The rule for every feature was: would an agent or team lead reach for this daily without admin rights?

| Role | Works in | Biggest pains AgentBuddy answers |
| --- | --- | --- |
| Service desk agent (L1) | Incidents, requests, calls, chats | Logging tickets fast, finding the fix, writing replies |
| Resolver (L2, L3) | Incidents, problems, tasks | Tickets with missing facts, long threads, "has this happened before?" |
| Catalog fulfiller | Requested items, catalog tasks | Reading variables, "what was fulfilled before", chasing blocked approvals |
| Customer service agent | Cases, accounts | No account context, cases bounced by engineering |
| HR case agent | HR cases | Confidential data, policy-correct wording (strict privacy mode) |
| Team lead | Queues, dashboards | Queue health without building reports, stale tickets, hand-overs |
| Knowledge owner | Knowledge bases | Duplicate and stale articles, not knowing what to write next |
| Major incident and change roles | Major incidents, changes | Updates every 30 minutes, CAB preparation, linking to a problem |

**Where the value is highest.** Teams that have no ServiceNow AI licence, run in regulated settings (privacy and security review is easy because of the design below), or work in Arabic or mixed-language queues. It is least needed where an organisation already has Now Assist everywhere and is happy with it.

**What the research says about the pain.** Wrong first assignment can add up to 10 times to triage time (Microsoft study, ICSE 2019). Agents spend 26% to 35% of their time searching for information across systems, and after-contact work is 6% to 25% of handle time (vendor-sponsored estimates). These are published industry figures, not measurements from our own pilot; a baseline from real agents is still to be taken.

## Features

The side panel has five screens, chosen from an icon bar at the bottom. After leaders found an earlier version cluttered, each screen now shows five rows. Everything else is one step away in an "All tools" button, so nothing was removed. Checks and lists run without AI; the AI actions come after a preview.

**The full guide.** Every feature has its own entry (what it does, how to use it, what it needs, what it sends) in the guide files: [Getting started](01-getting-started.md) to install and set up, [Ticket screen](02-ticket-screen.md) for every Insights card and AI action, [My work and Team](03-my-work-and-team.md) for the queue and the lead dashboards, [Write and Knowledge](04-write-and-knowledge.md) for replies, emails, snippets and the knowledge tools, and [Settings and admin](05-settings-and-admin.md) for settings, privacy, administrator policy and troubleshooting. The table below is the short version.

| Screen | What it gives the person |
| --- | --- |
| **Ticket** | Five rows, one per pain point: **understand the ticket** (summary, hand-off brief, missing information, sentiment and escalation risk, thread summary), **find the fix** (similar solved tickets, knowledge matches, error codes, "solved before by"), **the same caller** (their other tickets, repeat-issue warning, caller's language, "Brief me on this caller"), **reply** (draft, tone and next-step checks, translate the caller's message), **close well** (resolution check, close code from look-alikes, "Prepare to close") |
| **My work** | Your queue, most urgent first, in five rows with an "At risk" chip; "My week" summary of what you handled |
| **Team** | Needs-attention-now first, then overview, SLA radar, fulfilment, workload and quality dashboards; a one-click **Weekly report** (PDF, CSV or copy); report builder, saved dashboards, shift hand-over, "explain this dashboard"; an opt-in coaching snapshot that is off unless the organisation switches it on |
| **Write** | Customer reply drafts, six email types, rewrite (shorter, friendlier, plain, formal, fix spelling, translate, bilingual), notes to a new ticket, personal snippets with variables, a **safe-to-send** check before text reaches a customer |
| **Knowledge** | Article from a ticket, article checks and optimise, duplicate finder with a merge draft, knowledge-gap radar, chat summary and chat reply suggestions |

**Beyond the five screens**

- **Quick actions on the page.** A small icon bar at the bottom of the ServiceNow page starts the main actions with one click; the organisation can switch it off.
- **Keyboard shortcuts.** Alt+Shift+1 opens the panel, Alt+Shift+2 summarises, Alt+Shift+3 drafts a reply. Ctrl+K opens All tools.
- **"What goes in" before sending.** The person sees exactly what text will go to the AI and can mask more before pressing send.
- **Answer formats.** The person or the organisation chooses the sections, style and length of the summary, hand-off brief and catch-up, and can add extra instructions to any of 20 AI actions. Rules about facts, privacy and customers always stay on.
- **Domain packs.** Major-incident updates, problem statement and root-cause write-up, change and CAB brief, account briefing, case-to-engineering escalation, HR case brief.
- **Insert with Undo.** "Insert" fills one field on the open form and offers Undo; the person still presses Save.
- **Arabic and right-to-left layout**, dark mode, and a layout that works down to 320 px wide.

## How it is built

AgentBuddy is plain JavaScript and React 18 packaged as a Manifest V3 browser extension. It has no backend, no account and no analytics: everything runs in the person's browser, and the only network calls go to their ServiceNow and to the AI endpoint they or their organisation chose.

| Layer | Technology |
| --- | --- |
| Platform | Manifest V3 extension. Chrome 116+ and Edge share one package and use the browser's side panel. Firefox 128+ has its own package and uses its sidebar. One source tree; one small module (`platform.js`) knows how the browsers differ |
| User interface | React 18.3.1 and ReactDOM, the only two runtime dependencies. Side panel, settings page and a full-page dashboard, styled with shared colour tokens; works in dark mode, right-to-left Arabic and down to 320 px wide |
| Code | JavaScript with JSX, about 525 source files and 75,000 lines, split by area: PII firewall, AI providers, reads from ServiceNow, features and packs, reports, policy |
| Build | Node 22.12+ and esbuild 0.23. Builds are reproducible (the same source gives byte-identical files, checked by SHA-256), minified for release, with a software bill of materials in CycloneDX format |
| Reading ServiceNow | GET-only calls to ServiceNow's own table API using the person's signed-in session, so their roles and ACLs apply. A small bridge inside the page reads form values and fills one field. Nothing is installed in ServiceNow: no update set, no scoped app, no plugin |
| AI | Adapters for OpenAI-style APIs (Azure OpenAI, OpenAI, company gateways, Gemini, Mistral, Groq, DeepSeek, OpenRouter, local Ollama) and for Anthropic. The AI key is kept in the browser, in a vault, in memory only, or encrypted with a passphrase, as the organisation allows |
| Administration | Browser managed policy (Chrome and Edge schema, Windows registry, macOS profile, Google admin console, Firefox policies) can pin the AI provider and address, lock features and formats, and switch the on-page dock off. An enterprise build can compile one organisation's hosts and policy in |
| Quality | On 2026-11-22: 4,302 unit tests, 1,318 end-to-end checks each in real Chrome and Edge against a fake ServiceNow, 61 in Firefox, 0 failed; lint, compile check, control-to-test traceability and an Arabic completeness check (3,533 texts) run before every commit |

**One request, step by step.** The picture below follows a single action from reading the ticket to inserting the result: 9 steps, 2 outside destinations (the organisation's own ServiceNow and its own AI endpoint).

```mermaid
flowchart TD
  A[ServiceNow instance] -->|1. read with the person's own session, GET only| B[Content script]
  B -->|2. record and thread| C[Side panel]
  C -->|3. text| D[PII firewall: mask, seal, preview]
  D -->|4. person reviews what will be sent| E[AI provider adapters]
  E -->|5. masked text only| F[AI endpoint]
  F -->|6. answer with placeholders| E
  E -->|7. real values restored on the device| G[Answer in the panel]
  G -->|8. Insert| H[Page bridge]
  H -->|9. fills one field; the person presses Save| I[ServiceNow form]
```

Read the ticket with the person's own session, mask it, send only the masked text to the AI, restore the real values on the device, and fill one field; the person reviews and saves.

## Privacy, security and licensing

The design starts from the question a security reviewer asks, and answers it with the architecture rather than with promises. Controls are tied to automated tests in a traceability matrix, and anything not yet checked on a real instance is marked as unverified in the security notes.

- **Read-only.** The extension never writes to ServiceNow. "Insert" fills one field on the open form and the person presses Save.
- **Their own access.** Reads use the person's signed-in session, so ServiceNow's roles and ACLs decide what is visible. A read that is refused says so; it is never shown as "none".
- **Masking before the AI.** The record's people, and names the surrounding words mark in the text, are replaced with placeholders. The person sees exactly what will be sent and can mask more. Passwords, card numbers and ID numbers never come back into an answer.
- **No server of ours.** No vendor server, account or analytics. The local audit log keeps no ticket content.
- **Small permissions.** Access to a ServiceNow or AI address is requested one host at a time. The extension does not ask for tabs, history, cookies, web requests or downloads, and its page security policy allows no remote or inline scripts.
- **Sensitive data by default.** HR cases use a strict privacy mode gated by policy; security incident, vulnerability and GRC tables are treated as sensitive.
- **Organisation control.** Managed policy can pin the AI provider, address and models, choose where the key is stored, lock or publish answer formats, block tables and fields, and switch features off.

**Review pack for the security team.** Security notes with known limits, data-flow diagram, STRIDE threat table, control-to-test traceability matrix, a filled data protection impact assessment template, sample policies for each browser, and the bill of materials. Two independent security audits have been run on the code.

**Licensing and price (a proposal, not yet decided).** The code of a browser extension cannot be hidden from the machine it runs on, so protection would come from a licence contract, a signed licence key tied to the instance and an expiry date, and continuing updates. Because there is no backend, seats cannot be metered; the proposed model is an annual fee per ServiceNow instance, banded by agent count, plus a paid pilot and a setup fee. The customer pays their own AI usage.

## Status and what is next

The product is built through round 5 (2026-11-22) and passes all automated checks. It has been seen in part on a real ServiceNow instance, but it has not yet been piloted with real agents, so the time savings are not yet measured.

| Area | State |
| --- | --- |
| Features on the five screens | Built and tested against a fake ServiceNow |
| Chrome | Seen in part on a developer instance; more live checks open |
| Edge | Same package as Chrome; automated run passes, hand checks on a real instance open |
| Firefox | New on 2026-11-06; automated run in real Firefox passes; not yet checked on a real instance. Release also needs Mozilla signing |
| Safari | Not supported; planned once a Mac is available |
| Store release | Not published to any store; installed as an unpacked build or by managed policy |
| Measured impact | Not yet. Industry figures are quoted above; a baseline from real agents is the first step of a pilot |

**Next steps**

1. Walk the product on the real instance in Chrome, Edge and Firefox and close the open live questions.
2. Run a pilot with real fulfillers, a team lead and a knowledge manager, and take baseline numbers (time to first response, reassignments, handle time) before and after.
3. Decide how to release: a store listing or a self-hosted install by managed policy.
4. Decide the licence model and build the licence-key check.
5. Safari, once a Mac with Xcode is available.

**Decisions to take with leadership.** Which team joins the pilot, which AI endpoint the organisation will allow, and whether Team views may show per-person rows to managers only.
