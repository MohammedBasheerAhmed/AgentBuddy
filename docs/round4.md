# Round 4: "Loved" (contracts and ownership), 2026-11-06

Read this with `docs/build-rules.md` (in force, with the two exceptions below), `docs/contracts.md`, `docs/focus-layout.md` (the five
rows: understand the ticket, find the fix, same caller, reply, close well) and the approved mockup: the "Loved" row of boards on
https://claude.ai/artifact/WMmZMaVbxigc1WP3UrUgj3 (Ticket: new lines inside the five; Close well: Prepare to close; My work: tickets at
risk; one answer on classic, Workspace and portal).

## The product rule for this round (the user's words)

"It shouldn't be a clutter. We have to solve the pain points of the agents which ServiceNow is not able to solve within the platform."
So: **no new rows, cards, screens or header buttons.** Everything new is a line inside an existing row (the five Insights rows, the
existing cards), a fact inside an open row, the existing My work filter chips, or the existing answer card. Routing stays in All tools.

## Decisions taken by the user (2026-11-06)

1. Build the Phase 0 fixes and everything on the "Loved" boards.
2. **Exception to build rule 1 (one field):** "Prepare to close" may fill TWO fields with one Insert: the close code and the resolution
   notes (the right notes field per type), one `FILL_FIELD` each, after the agent saw both values. Nothing is saved. Undo puts both
   back. Same family as the Notes-to-ticket exception.
3. **Exception to build rule 7 (store no ticket content):** "since you last looked" keeps, in `chrome.storage.local`, per instance,
   the sys_id and table of a ticket the agent opened and the time (ISO). No number, no title, no text, no names. Capped (500 entries,
   30 days), cleared by Settings > Stored data > Clear all, and an organisation can turn it off with the new policy key
   `rememberLastViewed` (default true).
4. Nothing is committed; the user reviews first.

## Shared pieces (written by the lead; ask before changing them)

- `src/lib/scriptDetect.js`: `scriptOf(text)` -> 'arabic' | 'latin' | 'mixed' | 'other' | '', `isArabicText`, `normalizeArabic`.
- `src/insights/closeCode.js`: `closeCodeVote(hits, { current })` -> `{ enough, value, label, votes, of, numbers, line, matchesCurrent }`
  over solved look-alikes. `tests/round4-shared.test.js`.
- `src/context/similar.js` `toHit`: every look-alike hit now also carries `close_code_value` (the stored value) and `assigned_to` (a
  display name; it is on `HIT_PERSON_COLUMNS`, so it is masked if a hit ever reaches a prompt; never put it in a prompt on purpose).
- Empty, already wired files you fill: feature packs `src/features/packs/{translate,close}.js`; context specs
  `src/context/specs/{understand,fix,close}.js`; READ ops `src/content/ops/{fix,close}.js`; Arabic catalogues
  `src/i18n/ar/{langrules,reads,fix,understand,close,mywork,reply}.js`; CSS `src/ui/areas/{fix,close,reply,reads}.css`.

## Who owns what

| Agent | Scope | Owns (edit or create) |
|---|---|---|
| **A Languages** | Phase 0: search and no-AI rules that work for Arabic (and any non-Latin script) | `src/lib/similar.js`, `src/context/knowledge.js`, the `searchKeywords` function in `src/context/similar.js` (nothing else in that file), `src/knowledge/{similarity,text,gaps}.js`, `src/insights/{risk,missing,emailTemplates}.js`, `src/itsm/sentiment.js`, `src/checks/checklist.js`, `src/i18n/ar/langrules.js`, `tests/languages-*.test.js`, `docs/live-questions/i18n.md` (append) |
| **B Read safety** | Phase 0: security records sensitive by default; clear messages when the instance refuses or limits reads | `src/context/kinds.js` (sensitive prefixes only), `src/content/tableApi.js`, `src/content/reads.js`, `src/context/access.js`, `src/sidepanel/ticket/cards/bits.jsx`, `src/sidepanel/ErrorNote.jsx`, `src/i18n/ar/reads.js`, `src/ui/areas/reads.css`, `tests/reads-*.test.js`, new `docs/live-questions/reads.md` |
| **C1 Find the fix** | Find the fix row: error codes with one search; "solved before by" | new `src/insights/{errorCodes,solvedBy}.js`, `src/insights/{steps,fixes}.js`, `src/sidepanel/ticket/cards/{StepsCard,KnowledgeCard}.jsx`, `src/content/ops/fix.js`, `src/context/specs/fix.js`, `src/i18n/ar/fix.js`, `src/ui/areas/fix.css`, `tests/fix-*.test.js`, new `docs/live-questions/fix.md` |
| **C2 Understand** | Understand row: since you last looked; Translate the caller's message (AI) | new `src/lib/lastViewed.js`, new `src/insights/sinceLooked.js`, `src/sidepanel/ticket/{needsNow,useNeeds,focusView}.js`, `src/sidepanel/ticket/TicketInsights.jsx`, `src/sidepanel/ticket/cards/{JourneyCard,Glance}.jsx`, `src/content/ops/insights.js`, `src/context/specs/{insights,understand}.js`, `src/features/packs/translate.js`, `src/policy/policy.js` and `managed_schema.json` (only the key `rememberLastViewed`), `src/lib/storedData.js`, `src/options/data/StoredDataSection.jsx`, `src/i18n/ar/understand.js`, `src/ui/areas/insights.css`, `tests/understand-*.test.js`, new `docs/live-questions/understand.md` |
| **D Close well** | Close well row line; "Prepare to close" (AI) in the fifth slot; Insert of two fields; Undo after every Insert | `src/features/packs/close.js`, `src/features/focus.js`, `src/sidepanel/ticket/cards/ResolveCard.jsx`, `src/checks/{resolutionCheck,resolutionParts}.js`, `src/insights/closeCode.js` (extend only), `src/lib/fillable.js`, `src/content/fill.js`, `src/page/bridge.js`, `src/lib/messages.js`, `src/content/index.js` (message routing only), `src/sidepanel/{insertFlow,useInsertActions}.js`, `src/sidepanel/InsertFindings.jsx`, `src/sidepanel/ticket/assist/answers/**`, `src/features/picks.js`, `src/content/ops/close.js`, `src/context/specs/close.js`, `src/i18n/ar/close.js`, `src/ui/areas/close.css`, `tests/close-*.test.js`, new `docs/live-questions/close.md` |
| **E My work** | Tickets at risk first: one more filter chip and a reason per row; follow-ups with a ready draft | `src/mywork/**`, `src/sidepanel/mywork/**`, `src/content/ops/mywork.js`, `src/context/specs/mywork.js`, `src/ui/areas/mywork.css`, `src/i18n/ar/mywork.js`, `tests/mywork-*.test.js`, `docs/live-questions/mywork.md` (append) |
| **F Reply** | Reply row: the checks before a reply is sent (next step promised, tone, internal words) in English and Arabic; the reply row says the caller's language | `src/safeSend/**`, `src/sidepanel/write/SafeSendCheck.jsx`, `src/sidepanel/ticket/cards/EmailCard.jsx`, `src/compose/emailRecommend.js`, `src/i18n/ar/reply.js`, `src/ui/areas/reply.css`, `tests/reply-*.test.js`, `docs/live-questions/compose.md` (append) |
| **Lead** | Shared pieces, wiring, docs (build-rules, security, deployment, TRACKER, CHANGELOG), e2e (fake instance and scenarios), the full runs, the mockup | everything else |

**Shared Arabic files** (`src/i18n/ar/*.js` other than yours): you may only DELETE the entry of an English text you removed or changed,
with Edit (never Write). New texts go into your own Arabic file. `node scripts/i18n-check.js` must say 0 missing and 0 unused.

**Known failure not yours:** `tests/ticket-rail.test.js` "the screen publishes the Insights rail..." fails on the date ("9 d ago" vs
"10 d ago"); leave it to the lead.
