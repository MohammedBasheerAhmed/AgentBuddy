# Agent Buddy: progress

Plan: `C:\Users\bashe\.claude\plans\we-need-to-create-stateful-dawn.md` (approved 2026-10-26). Contracts between modules: `docs/contracts.md`.

## RESUME HERE (2026-10-26)

Built (M0 foundations, all unit-tested):
- Repo, build (`npm run build` -> `dist/`), test runner (`npm test`, `node tests/run.js <filter>`).
- `src/policy` managed policy (floors, locks, allow-lists), `src/lib/keyStore.js` (local / session / passphrase-encrypted), `src/audit` (no-content audit log), `src/providers` (trimmed from NowBuddy; only accepts firewall-sealed requests), `src/content/tableApi.js` (GET-only), `src/page/bridge.js` (read + fill one field, no save), service worker (registers content scripts only on enabled instances), side panel + settings page.
- Guard tests: `manifest.test.js` (permission snapshot), `readonly.test.js` (no writes anywhere), `pipeline.test.js` (policy gating, audit has no content).

Built by parallel agents (check each reported clean): `src/pii` (firewall, safeSend), `src/render` + `src/snippets`, `src/context`.

Open next:
1. Wire `src/content/reads.js` (`handleRead`) to `src/context` once its API is final; build `dist/`; load unpacked in Chrome.
2. Live check on the PDI (dev364920) as a NON-admin user: record detection (classic + workspace), reads, ACL-hidden tables, journal fallback, Insert on classic and workspace forms.
3. Wave 1 features still to build: A2 caller history, A3 similar, C4 KB recs, A9 request explainer, B2 email composer, B3 safe-to-send wiring (done in ResultView), B5 snippets UI, F1 My Day.
4. M4 security review pack (`docs/security.md`, threat model, data-flow diagram, permission table, DPIA template, SBOM).

Decisions: see memory `agent-buddy-extension` (separate repo, side panel, plain local key storage by user choice with switchable modes, name "Agent Buddy").
