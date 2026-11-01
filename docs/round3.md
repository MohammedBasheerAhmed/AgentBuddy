# Round 3: building the agreed plan (contracts and ownership)

Read this with `docs/build-rules.md` (still in force: no writes to ServiceNow, every AI call through `useRun`, fixed prompts, only
`--ab-*` tokens, tests next to the work, own files only, do not commit), `docs/contracts.md`, and the plan: `TRACKER.md` sections 1,
2 and 3 (the rows are the scope) and `docs/agent-pain-points.md` (why each item matters).

## What changes for the person using it

- The panel has five **screens**: Ticket, My work, Team, Write, Knowledge (Team only for the team-lead profile; policy can hide
  screens). The header is quiet: name, the instance, a settings icon, a shield mark instead of the footer sentence.
- Every screen that has both is split into **Insights** (no AI: facts, lists, checks, templates; nothing leaves ServiceNow) and
  **AI Assist** (AI: masked text goes to the chosen AI after a preview). A switch under the screen title picks the half; the choice
  is remembered per screen (`settings.halves`).
- **Work profiles** (`src/profiles/profiles.js`) decide what is shown: `shownFor(itemProfiles, eff)`. The ticket decides what is
  possible; a ticket outside the profiles still works (the shell shows a hint offering to add the profile).
- **AI on or off:** `aiAvailable(eff)` is false when the organisation set `aiEnabled: false` (no AI Assist half at all) or the
  person chose "Skip AI for now" (`settings.aiSkipped`; the AI Assist half says how to set AI up).

## Design rules (TRACKER.md 2.3 and 2.4: checked on every screen before it is Done)

- **Inviting, not cluttered.** One primary (filled) button per screen; at most 4 visible buttons on a card (the rest under "More");
  one line of helper text per card; never the same sentence twice on a screen; show 3, fold the rest ("Show all (12)"); answers
  appear where the person is looking; useful empty states; a read longer than 3 s says what it waits for.
- **AI mark:** every AI button, tab and answer carries `<AiBadge/>`; no Insights element ever does. AI elements use the
  `--ab-ai*` tokens; Insights uses the existing green `--ab-accent*`.
- **Names:** actions start with a verb ("Summarise ticket", "Draft reply"); views are nouns ("Related tickets").
- **Building blocks** (`src/sidepanel/ui/primitives.jsx`, styles in `src/ui/areas/shell.css`, owned by the lead):
  `AiBadge`, `ShieldMark`, `CardFrame` (title, one-line summary, attention '' | 'warn' | 'danger', folds), `ShowMore`,
  `HalfSwitch`, `HalfPanel`, `HalfRule`, `EmptyNote`. Use them; ask the lead for a change instead of copying them.
- Panel width 320 to 480 px. Keyboard reachable, visible focus, screen-reader names, `prefers-reduced-motion` respected.

## The shell (owner: the lead) and the plug-in points

```
App.jsx            header, screens, banner, pending draft          (lead)
  Ticket screen    src/sidepanel/ticket/TicketView.jsx            (lead) reads the header, owns the half switch, the launch
    Glance         src/sidepanel/ticket/cards/index.js  Glance    (Insights agent)
      quick bar    src/sidepanel/ticket/assist/actions  QuickBar  (Actions agent), drawn inside Glance
    Insights half  INSIGHT_CARDS from ticket/cards/index.js, each in a CardFrame drawn by the lead's TicketInsights.jsx
    AI Assist half TicketAssist.jsx (lead) = AnswerArea + AskBox (Answers agent) + ActionGroups (Actions agent)
  My work          src/sidepanel/mywork/index.js        default   (My work agent)
  Team             src/sidepanel/team/index.js          TeamInsights, TeamAssist           (Team agent)
  Write            src/sidepanel/write/index.js         WriteInsights, WriteAssist         (Write & Knowledge agent)
  Knowledge        src/sidepanel/knowledgeScreen/index.js KnowledgeInsights, KnowledgeAssist (Write & Knowledge agent)
```

Each index file exists now with a stand-in that wraps the old view, so the panel works at every step. Replace the stand-in with
your work; keep the export names and props.

| Plug-in | Props it receives | Notes |
|---|---|---|
| `INSIGHT_CARDS` entry | `{ id, title, kinds: ['*'] \| [kinds], profiles: ['all'] \| [ids], order, defaultOpen?, Card }` | The lead draws each in a `CardFrame` in `order`, filtered by kind and `shownFor(profiles, eff)`. |
| `Card` | `{ page, eff, record, header, active, open, setSummary(text), setAttention(level), onShowCard(id) }` | `active`: the Insights half is on screen, folded or not (fill the summary line); `open`: the body shows (a heavy read may wait for it). `setSummary` fills the one-line summary shown next to the title. |
| `Glance` | `{ page, eff, record, header, headPhase, quickBar }` | Draw `quickBar` (a node) inside it. `header` is today's `header` read; read more through your own op. |
| `ActionGroups` | `{ page, eff, record, header, busy, aiReady, onRun(feature, options) }` | `onRun` is `assist.run`: the one way to start AI. `options.getPack` as in `useRun`. |
| `QuickBar` | `{ page, eff, record, header, busy, aiReady, onRun(feature), onShowCard(cardId) }` | `onShowCard` switches to Insights and opens that card (for no-AI quick items such as "Ready to resolve?"). |
| `useAnswers({ page, eff, record })` | returns at least `{ run(feature, options), busy, reset }` | Wraps `useRun`; every AI call still goes through it. |
| `AnswerArea`, `AskBox` | `{ assist, page, eff, record, active }` (AskBox is drawn only when AI is ready) | `assist` is what `useAnswers` returned. Drawn ABOVE the action groups. |
| My work `default` | `{ page, eff, active, onOpenTicket() }` | Call `onOpenTicket` after a plain click opened a ticket in this tab: the shell switches to the Ticket screen. |
| Team / Write / Knowledge halves | `{ page, eff, active }` | `*Assist` may be `null` if the screen has no AI half. |

`aiReady`: AI can be used right now (organisation allows it, not skipped, key and model set). When false, AI actions are shown disabled (or the quick bar keeps only its Insights items); the shell already shows the set-up note above the actions.

A feature definition may carry these new fields (read by the Actions and Answers agents' code):
`group: 'understand' | 'reply' | 'work' | 'resolve'`, `primary: 'copy' | 'insert'` (copy first for notes to self),
`profiles: [...]` (overrides `FEATURE_PROFILES`), `when(record, header) -> boolean` (state rules; absent = always).

## Who owns what

You may create files in your folders and edit only the files listed for you. Anything else: describe the exact change in your
report and the lead applies it. Policy keys, settings defaults, profiles, registries, the shell and the shared helpers are the
lead's and already contain everything below (`aiEnabled`, `disabledSections`, `allowedProfiles`, `lockedProfiles`,
`orgSnippets`, `internalPhrases`; settings `profiles`, `profilesConfirmed`, `showEverything`, `aiSkipped`, `halves`).

| Agent | Tracker rows | Owns (edit) |
|---|---|---|
| **Insights** | N1-N12, N20, N24-N26, N28, N29 | `src/sidepanel/ticket/cards/**`, new `src/insights/**`, `src/content/ops/insights.js`, `src/context/specs/insights.js`, `src/context/related.js`, `src/context/similar.js`, `src/sidepanel/RelatedView.jsx`, `recordHeader.js`, `openRecord.js`, `RecordLink.jsx`, `linkClick.js`, `src/sidepanel/tabs/{QualityGateView,RequestExplainerView,FulfilmentChecklistView,KnowledgeRecordView,ChatRecordView}.jsx`, `src/sidepanel/checks/**`, `src/checks/**`, `src/itsm/sentiment.js`, `src/domain/accountCases.js`, `src/ui/areas/{insights,checks,itsm,domain}.css` |
| **Actions** | AI1-AI22 (feature fixes, grouping, state), F5 (Insert mechanics), F6 (panel quick bar) | `src/sidepanel/ticket/assist/actions/**`, `src/features/packs/{core,itsm,domain,knowledge,checks,compose,kinds}.js`, new `src/features/stages.js`, `src/features/quick.js`, `picks.js`, `partColumns.js`, `src/sidepanel/QuickBar.jsx`, `insertFlow.js`, `pendingDraft.js`, `PendingDraft.jsx`, `src/lib/fillable.js`, `src/content/fill.js`, `src/page/bridge.js`, `src/ui/areas/{assist-actions,quick}.css` |
| **Answers** | AI0.4, AI0.5, AI0.2 (preview screen), AI23 (rewrite on an answer) | `src/sidepanel/ticket/assist/answers/**`, `src/sidepanel/{useRun,runFlow,runLogic}.js`, `RunPanel.jsx`, `ResultView.jsx`, `PreviewDialog.jsx`, `ReviewHints.jsx`, `ErrorNote.jsx`, `src/features/packs/assist.js`, `src/ui/areas/assist-answers.css` |
| **Payload** | AI0.3, AI0.2 (HR records need Strict for every function) | `src/pii/firewall.js` (request building only), `src/features/parts.js`, `src/prompts/rules.js`, `src/context/journal.js`, `src/lib/pipeline.js`, `src/providers/messages.js`, new `src/lib/tokens.js`, `src/itsm/parts.js`, `src/itsm/reference.js`, `src/domain/parts.js`, `src/knowledge/parts.js`, `src/chat/parts.js`, `src/checks/{checklistParts,resolutionParts}.js`, new `scripts/payload-report.js` |
| **My work** | N13, N14, N27 | `src/sidepanel/mywork/**`, `src/sidepanel/MyDayView.jsx`, `src/reports/myDay.js`, new `src/mywork/**`, `src/content/ops/mywork.js`, `src/context/specs/mywork.js`, `src/ui/areas/mywork.css` |
| **Team** | N15-N17, AI28-AI30 | `src/sidepanel/team/**`, `src/sidepanel/reports/**`, `src/sidepanel/tabs/ReportsView.jsx`, `src/sidepanel/charts/**`, `src/reports/**` (not `myDay.js`), `src/dashboard/**`, `src/features/packs/reports.js`, `src/content/ops/reports.js`, `src/context/specs/reports.js`, `src/ui/areas/reports.css` |
| **Write & Knowledge** | N18, N19, N21, N22, N23, AI24-AI27 | `src/sidepanel/write/**`, `src/sidepanel/knowledgeScreen/**`, `src/sidepanel/compose/**`, `src/sidepanel/knowledge/**`, `src/sidepanel/tabs/{ComposeView,KnowledgeToolsView}.jsx`, `src/compose/**` (keep `emailRecommend.js`'s exports stable: the Insights agent uses it for N20), `src/snippets/**`, `src/safeSend/**`, `src/knowledge/{articleChecks,gaps,similarity,text,sections}.js`, `src/context/knowledge.js`, `src/content/ops/{compose,knowledge}.js`, `src/context/specs/{compose,knowledge}.js`, `src/ui/areas/{compose,knowledge}.css` |
| **Foundation** | F1, F2, F3, F4, F6 (page tab), F7 (`tabs/Stub.jsx`), F8, F9 (first-run question and Settings UI), R1, R2, R4 | `src/background/**`, `src/content/{index,bar,barLogic,barSync,tableApi,sessionToken,reads,pageBridge,policyGuard}.js`, `src/content/bar.css`, `src/context/{kinds,access,surface,pack,live,util}.js`, `src/options/**`, `src/sidepanel/{SetupView,FirstRun,AiKeyNote}.jsx`, `src/sidepanel/{firstRun,aiReady,usePage,pageState}.js`, `src/sidepanel/tabs/Stub.jsx`, `src/lib/{keyStore,aiPermission,launch}.js`, `.github/**`, new `scripts/package.js`, `CHANGELOG.md`, `e2e/run.js`, `src/ui/areas/setup.css` |
| **Lead** | the shell, profiles, policy, integration, F10 | `App.jsx`, `sections.js`, `Tabs.jsx`, `src/sidepanel/ui/**`, `src/sidepanel/ticket/*.jsx` (not the sub-folders), `RecordView.jsx`, `recordTabs.js`, `src/profiles/**`, `src/policy/**`, `managed_schema.json`, `src/features/registry.js`, `src/content/ops/{index,profiles}.js`, `src/context/specs/index.js`, `src/ui/{theme,ui}.css`, `src/ui/areas/shell.css`, `e2e/{harness,ui,common}.js`, docs |

Tests: every agent owns the `tests/*.test.js` that cover its files and adds `tests/<area>-*.test.js` for new work. A test of
someone else's area that breaks because of your change means your change is wrong (or the contract above is): say so in the report.

## End-to-end runs in parallel

Never run `node build.js` or `npm run e2e` (they write the shared `dist/`). Build into your own folder and point the harness at it:

```
node build.js --out .build-tmp-<you>
E2E_DIST=.build-tmp-<you> AB_E2E_TMP=<your scratch folder> node e2e/run.js <scenario letters>
```

The lead is rebuilding the shell; its first version (screens, halves, `TicketView.jsx`) lands early. Do the logic, the views and the
unit tests first. **Before you update e2e scenarios, check that `src/sidepanel/ticket/TicketView.jsx` exists**; then update the
scenarios of your area (map below) to the new screens and fix the shared helpers only through the lead.

| Scenarios | Owner |
|---|---|
| a, b, h, k, v, w, y | Foundation |
| c, f, j | Answers |
| d, l, n, o, u, x, z | Actions |
| i, q (the Insights parts), r (the chat and article cards) | Insights |
| g | My work |
| s | Team |
| p, t, r (the knowledge tools) | Write & Knowledge |
| e, m | Lead |

## Your report (final message)

1. Rows of `TRACKER.md` done, partly done (what is left), not done (why).
2. Files created and changed.
3. Tests added; `node tests/run.js` and `node scripts/check-compile.js` results; e2e scenarios run and their results.
4. Exact changes you need in files you do not own.
5. What you assumed about ServiceNow and could not verify (also in `docs/live-questions/<area>.md`).
