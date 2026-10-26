# Agent Buddy

A privacy-first browser extension that helps ServiceNow **fulfillers** (IT, customer service, HR cases, catalog) and their
**team leads** work tickets faster. No admin role needed.

- Summarise a ticket, draft a customer reply, write resolution notes, write a hand-off brief, list missing information.
- "My day": your own queue, most urgent first. No AI needed.
- Works with any AI key: OpenAI-compatible (Azure OpenAI, company gateways), Anthropic, Gemini, Mistral, Groq, OpenRouter, or a model
  on your own computer (Ollama).
- Personal data is masked before any AI call; you can see exactly what is sent. Nothing is ever written to ServiceNow by the
  extension: "Insert" fills a field on the open form and you press Save.

Details: `docs/plan.md` (the approved plan and use-case catalogue), `docs/security.md`, `docs/deployment.md`,
`docs/contracts.md` (module contracts), `PROGRESS.md` (where we are).

## Build and run

```
npm install
npm run build        # writes dist/
npm test             # unit tests
```

Load `dist/` at `chrome://extensions` (Developer mode, Load unpacked), click the Agent Buddy toolbar button to open the side panel,
then "Turn on for this site" on your ServiceNow tab and add an AI key in Settings.

## Layout

```
src/background   service worker (registers content scripts only on enabled instances)
src/content      content script: record detection, GET-only reads, fill one field
src/page         page-world bridge (reads form identity/values; fills one field; no save)
src/context      what a feature may know about a record (field allowlists, journal, history, similar, KB)
src/pii          the PII firewall: detect, mask, seal, rehydrate
src/safeSend     check text before it goes to a customer
src/providers    AI provider adapters (only accept firewall-sealed requests)
src/policy       managed policy rules
src/features     use-case registry and prompts
src/reports      My Day (more reports to come)
src/render       safe plain-text renderer for model output
src/snippets     canned replies with variables
src/sidepanel    the side panel UI        src/options   the settings page
```
