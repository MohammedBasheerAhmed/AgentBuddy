# Agent Buddy

A privacy-first browser extension that helps ServiceNow **fulfillers** (IT, customer service, HR cases, catalog) and their
**team leads** work tickets faster. No admin role needed. It works on the classic UI, on Workspaces and on portals (Service Portal,
Employee Center, customer service and HR portals).

What it does (the side panel has five sections: This page, My day, Team, Write, Knowledge):

- **Understand a ticket**: summary, hand-off brief, missing information, sentiment and escalation risk, next-best action, thread
  summary, routing hint, request explainer, resolution check, fulfilment checklist. No AI needed for the checks and lists.
- **Domain packs**: major-incident updates, problem statement / RCA, change / CAB brief, account briefing, case-to-engineering
  escalation, HR case brief (Strict privacy mode, policy-gated).
- **Write**: customer reply drafts, six email types, rewrite (shorter, friendlier, plain, formal, fix spelling, translate, bilingual),
  notes to a new ticket, personal snippets, a safe-to-send check before text goes to a customer.
- **Knowledge**: article from a ticket, article checks and optimise, duplicate finder with a merge draft, knowledge-gap radar, chat
  summary and chat reply suggestions.
- **My day and Team**: your queue most urgent first; team dashboards (overview, SLA radar, fulfilment, workload, quality), a report
  builder, saved dashboards, CSV export with names masked, a full-page view, shift hand-over, "explain this dashboard", and an
  opt-in coaching snapshot (off unless the organisation switches it on).
- Works with any AI key: OpenAI-compatible (Azure OpenAI, company gateways), Anthropic, Gemini, Mistral, Groq, DeepSeek, OpenRouter,
  or a model on your own computer (Ollama).
- Personal data is masked before any AI call; you can see exactly what is sent. Nothing is ever written to ServiceNow by the
  extension: "Insert" fills a field on the open form and you press Save.

Details: `docs/plan.md` (the approved plan and use-case catalogue), `docs/security.md` (controls, limits, threat model),
`docs/deployment.md` (managed policy, feature ids), `docs/contracts.md` (module contracts), `docs/build-rules.md` (the rules every
change follows), `docs/live-questions/` (what must be checked on a real instance), `docs/review/` (the independent reviews),
`PROGRESS.md` (where we are).

## Build and run

```
npm install
npm run build        # writes dist/
npm test             # unit tests
npm run check        # compiles every build entry without writing anything
npm i --no-save puppeteer-core && npm run e2e   # real Chrome against a fake ServiceNow and a stub AI server
```

Load `dist/` at `chrome://extensions` (Developer mode, Load unpacked), click the Agent Buddy toolbar button to open the side panel,
then "Turn on for this site" on your ServiceNow tab and add an AI key in Settings.

## Layout

```
src/background   service worker (registers content scripts only on enabled instances)
src/content      content script: record detection, GET-only reads (ops/), policy guard, fill one field
src/page         page-world bridge (reads form identity/values; fills one field on classic, Workspace and portal pages; no save)
src/context      what a feature may know about a record (field allowlists, specs per kind, journal, history, similar, KB, related)
src/pii          the PII firewall: detect, mask, seal, rehydrate (only place that may import the seal)
src/safeSend     check text before it goes to a customer (one implementation)
src/providers    AI provider adapters (only accept firewall-sealed requests)
src/policy       managed policy rules
src/features     feature registry and packs (core, itsm, domain, knowledge, compose, reports, checks)
src/prompts      the fixed prompt of each feature
src/itsm src/domain src/knowledge src/chat src/compose src/checks   deterministic parts of each area
src/reports      report engine (injected deps, cache, limiter), AI hand-over / coaching / insights
src/dashboard    the full-page dashboard         src/render     safe plain-text renderer for model output
src/snippets     canned replies with variables   src/audit      no-content audit log
src/sidepanel    the side panel UI (sections, tabs, charts, compose, knowledge, checks)
src/options      the settings page               src/ui         shared styles (tokens --ab-*) per area
e2e              end-to-end harness: leak detector, request-log checks, scenarios a-u
docs             security, deployment, contracts, build rules, live questions, reviews
```
