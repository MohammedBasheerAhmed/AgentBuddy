# Agent Buddy: production plan and tracker

The plan for taking Agent Buddy from "works against a fake ServiceNow" to "approved and used daily by real agents", and the
status of every item. The plan was agreed on 2026-10-30; round 3 is built and was pushed to `main` on 2026-11-01 (see the
progress log). **Next session: start at "Where to pick up" just below.**

**Status:** `Planned` (in the plan, not yet agreed) · `Agreed` (you approved the plan for it) · `Building` · `Ready for review`
(built, tested and pushed; waiting for you to see it working, best on the real instance in V1) · `Partly built` (the row says
what is left) · `Done` (built, tested, shown to you, committed) · `Needs you` (only you can do it) · `Dropped`.

## Where to pick up (updated 2026-11-07)

**Round 4, "Loved", 2026-11-06/07 (newest, NOT committed: you review first):** after the fulfiller report
(https://claude.ai/artifact/AgCNQgWksLoae67KHnUmUB) you set the rule "no clutter; solve the pain points ServiceNow cannot solve in the
platform" and approved the "Loved" mockup boards (https://claude.ai/artifact/WMmZMaVbxigc1WP3UrUgj3, bottom row) and four decisions
(`docs/round4.md`): build the Phase 0 fixes and the boards; "Prepare to close" may fill two fields; "since you last looked" may keep
ticket ids and times; do not commit. Built by seven agents in parallel (table row R21). Phase 0: Arabic and other non-Latin tickets now
get look-alikes, knowledge, risk and missing-details rules and Arabic email templates; security incident, vulnerability and GRC tables
are sensitive by default; refused or limited reads say why. New, inside the existing five rows: since you last looked, Translate the
caller's message (AI), error codes with one search, solved before by, the reply checks (a next step, the tone) and the caller's
language, the close code from look-alikes, a repeat-issue warning, "Prepare to close" (AI) in the fifth slot, Undo after every
Insert, and My work's "At risk" chip. Next: your review in the panel, then the real-instance walk on dev364920 (the new live questions
in `docs/live-questions/{reads,fix,understand,close}.md` and the additions to i18n, mywork, compose), then commit and push on your word.

**More browsers, 2026-11-06 (newest):** you asked for Agent Buddy in Chrome, Edge, Firefox and Safari and approved five phases
(table rows R16 to R20). Phases 1 and 2 are built, checked and committed on 2026-11-06 (not pushed yet):
one module knows how the browsers differ (`src/lib/platform.js`); the sender check accepts the extension's own pages in every browser
(`src/lib/senderCheck.js`); one build per browser family (`node build.js --browser firefox` writes `dist-firefox/`; `dist/` stays the
Chrome and Edge build, unchanged); the Firefox build (its sidebar, Firefox 128 or later), its policy files and self-hosted install
(`docs/deployment.md`, "Firefox"), an automated run in real Firefox (`npm run e2e:firefox`), and the documents (`docs/security.md`
section 3A, the review pack, README, build rule 12, `docs/contracts.md`). Firefox works like Chrome except one thing you approved: with
the sidebar closed, a click on the dock cannot open it, so the dock asks for the toolbar button and the action starts if the panel
opens within 30 seconds. Next: the Edge check with you on dev364920 (phase 3, `docs/live-questions/edge.md`), then Firefox on dev364920
(`docs/live-questions/firefox.md`; you install Firefox). Safari waits for a Mac with Xcode (phase 4). Release packages per browser,
store accounts, the addons.mozilla.org decisions and the pull into the ifBash copy are phase 5.

**Focus layout of 2026-11-05 (after your leaders' "too many features, it looks cluttered"):** every tab of the Ticket screen
shows five, one per pain point you chose (understand the ticket, find the fix, the same caller, reply, close well); everything else is
one step away in All tools (the header's grid button, Ctrl+K, or "More for this ticket" at the end of each half). New: the card
"Caller's other tickets" (N30) and the AI action "Brief me on this caller" (AI31). The side rail is off unless Settings turns it on.
Mockup boards "Focused" and "All tools" on https://claude.ai/artifact/WMmZMaVbxigc1WP3UrUgj3; spec `docs/focus-layout.md`; table row
R15. Built and pushed on 2026-11-05 (`f8c80f9`); seen in the fake ServiceNow only: look at it in the real panel on dev364920.

**Side rail layout of 2026-11-05 (partly superseded by the focus layout above):** the screens in a bar at the bottom, everything a screen offers in a rail on the right (the
Ticket screen: every Insights card or every AI action; the other screens: their sections), the Ticket screen's top compact with
Insights | AI Assist straight under it, Settings > Side rail to hide and order the rail per kind of record. From a mockup you approved
(https://claude.ai/artifact/WMmZMaVbxigc1WP3UrUgj3); spec and decisions: `docs/rail-layout.md`. Built and pushed on 2026-11-05 (`336e517`,
CI passed); seen in the fake ServiceNow only (unit 3,050, e2e 1,169 of 1,169): look at it in the real panel on dev364920. Table row R14.

**Audit of 2026-11-04 (newest first):** seven read-only reviews found about 110 defects the tests did not catch; all are fixed in seven
commits on `main`, pushed on 2026-11-05 with the redesign and the side rail (table row R12). What was found, the commits, and what is
still yours to decide (one meaning of a ticket's state across five classifiers; one reader of "Label: text" answers):
`docs/review/audit-2026-11-04.md`. Unit tests 2,968 (3,022 before the unreachable code and its tests went), end-to-end 1,163 checks;
`npm run verify` runs every gate CI runs, lint first.

**Redesign of 2026-11-05 (after the audit):** "calm and focused", from a mockup you approved (design canvas
https://claude.ai/artifact/FG1sRNpKMA8e5LVjCAfbyC: today, the mockup and the built panel side by side). Built and pushed on
2026-11-05 (table row R13); seen in the fake ServiceNow only: look at it in the real panel on dev364920 (the side panel itself cannot be driven by automation).

Everything above but the multi-browser work is on GitHub (up to `f8c80f9`). Status: 93 ready for review (R16 and R17
committed, not pushed yet), 4 need you (V1 to V3, R18), 1 partly built (R20), 1 agreed for later (R19). On the real
instance: 1 seen fully, 4 partly; none of R11 to R20 yet. The functions page (https://claude.ai/artifact/KSd7hDgkEyR5RR7d8q7iQX) shows
the table in section 3 (not yet R16 to R20).

**Done since the last wrap-up (2026-11-01, one long session):**

- **R1, e2e on GitHub:** passes on `ubuntu-latest`. The cause was headless Chrome on Linux making the popup that holds the panel the
  "last focused window"; the harness takes the main window's focus away and gives it back. A failed scenario prints pages, windows, a
  focus log and errors; the workflow can be run by hand with a list of scenarios. The job no longer is allowed to fail: it passed three
  full runs in a row on GitHub (1,057 of 1,057) after two timing flakes were fixed (scenarios o, c, q and zy).
- **R6 accessibility and dark mode:** scenario `zz` audits every screen in light and dark (contrast, names, labels, focus, 24 px targets,
  reduced motion, 320 px); it found and we fixed two faults.
- **Masking for Arabic tickets (a gap found on the way):** a phone or card number in Arabic digits, a password after "كلمة المرور", an
  Emirates or Saudi ID, an employee number and a birth date named in Arabic, and Arabic spellings of a name, all reached the AI unmasked.
  Fixed (`src/pii/arabic.js`), 17 tests.
- **R8 Arabic:** see the table. How it is built is in `docs/i18n-arabic.md`; `node scripts/i18n-check.js` lists any text without an Arabic
  entry. Nothing sent to the AI, no prompt and no data label is translated.
- **R6 shortcuts, R3 self-hosted install, R5 minified build:** see the table. Decisions made by Claude on your instruction "take the best
  approach": shortcut keys are digits (they work with an Arabic keyboard layout); the release is minified with a readable copy.

- **R9 look and feel, colours, command palette (built after your "the ui ux is not at all great"):** compared with NowBuddy and rebuilt the
  header, the ticket at a glance and the quick actions; added Settings > Appearance (light, dark, same as the computer, also for the
  bar on the ServiceNow page) and the command palette (`Ctrl+K`). Steps 1 to 3 of the plan only: the other screens (My work, Team,
  Write, Knowledge, the Settings page) are not restyled yet. Questions for you in `docs/live-questions/look.md`.

**Done since then (2026-11-03):**

- **R10 icon docks (after your "the small side bar is not looking great ... icons, on hover it will show what it is"):** the bar on the
  ServiceNow page is now a pill at the bottom centre with one round icon per action (names on hover and on the keyboard, folds to the
  mark, drag or arrow keys move it along the bottom), and the panel's screens (Ticket, My work, Team, Write, Knowledge) are an icon dock
  at the bottom centre of the panel. Scenarios `y`, `z`, `zy`, new `zw`, `tests/bar-logic.test.js`, new `tests/icon-dock.test.js`.
  Questions for you: `docs/live-questions/quickbar.md` (19 to 22) and `look.md` (8 to 10). Also two summary rows ("By table" and the
  setup "more") are now 24 px tall (the dock next to them showed they were 23).
  (The tests that time a parse used to fail on a busy computer; since the audit of 2026-11-04 they measure CPU time and do not.)

- **R11 answer formats (after your "summarize incident is providing some defaulted thing ... in a particular format ... similar things for
  AI functionalities"):** the ticket summary, the hand-off brief and the discussion catch-up take sections you name and order, a style and
  a length; 20 AI actions take extra instructions; both are edited in Settings > AI Assist and under the action in the panel; an
  organisation can publish or lock a format (`orgFormats`). Rules, customer safety and the firewall's data rule always stay. Scenario new
  `zv`, `zy`, `zz`; `tests/formats.test.js`, `tests/formats-editor.test.js`. Questions for you: `docs/live-questions/formats.md`.

**When you say "continue", Claude starts here:**

0. **Finish the multi-browser work.** Integrate and check phases 1 and 2 (`npm run verify`, `node scripts/traceability.js`,
   `npm run e2e`, `npm run e2e:firefox`), fill in the Firefox `setAccessLevel` result in `docs/security.md` limit 17, then commit
   (push when you say). Then phase 3 with you: `docs/live-questions/edge.md` in Edge on dev364920 (it can go with V1 below), and
   `docs/live-questions/firefox.md` once Firefox is installed.
1. **V1, the real-instance walk-through, whenever you are at Chrome.** Reload Agent Buddy in the already-open Chrome from
   `D:\AgentBuddy\dist` (no separate automation window), sign in to dev364920 yourself, and walk a real ticket screen by screen, in
   English and in Arabic. Answer the open questions in `docs/live-questions/`, `i18n.md` first (does the Arabic read well, is the layout
   right in the real side panel, the shortcuts in Chrome and Edge on Windows and Mac, a ServiceNow whose own language is Arabic), then
   these four: the email form takes Insert or forces Copy (`compose.md` 3), Chrome accepts the `defaultDashboard` policy as one object
   (`policy.md` 15), priority-account names match the case (`policy.md` 16), the labels of a Workspace's notes boxes (`checks.md` 20).
2. **The self-hosted install on two pilot computers** (`docs/deployment.md`, "Self-hosted install"): you need managed computers, an
   https address for the files, and someone to keep the signing key (`node scripts/selfhost.js init`).
3. **V2, AI answer quality.** Every AI function on real tickets with DeepSeek (you enter the key in Settings, never in chat), Arabic
   tickets included.
4. A small leftover: ServiceNow-in-Arabic comparisons of displayed values (`docs/live-questions/i18n.md` 4).
5. **R9, next steps:** look at the new header, tiles and palette in the real panel (`docs/live-questions/look.md`), then restyle My work,
   Team, Write, Knowledge and the Settings page the same way.

How to check a change: `npm run verify` (unit tests, compile check, `traceability.js --check` and the Arabic check, the same gates as
CI; run `node scripts/traceability.js` without `--check` to rewrite a stale review map), then `npm run e2e` (builds `dist/`, then real
Chrome; `npm ci` installs puppeteer-core; README "End-to-end" says what else it needs) and `npm run e2e:firefox` (the Firefox build
in real Firefox, `e2e/firefox/`). Rules for every change: `docs/build-rules.md`.

---

## 1. The idea: every screen split into Insights and AI Assist

Today AI and non-AI features are mixed on every screen: the record's Actions list is all AI, its Related and Check tabs are not,
Write is mostly AI, Team is mostly not. Neither an agent nor a security reviewer can tell at a glance what sends data out.

**The plan (agreed 2026-10-30): every screen of the panel has two parts with one clear rule each.**

| | **Insights** | **AI Assist** |
|---|---|---|
| What it does | Facts, lists, checks, dashboards, templates, built from what the agent can already see in ServiceNow | Summaries, drafts, rewrites, explanations written by an AI model |
| Where data goes | **Nowhere.** Reads with the agent's own session, GET only, and stays in the browser | Masked text goes to the one AI provider the organisation chose, after a preview |
| Needs | Nothing (no key, no outside host) | An AI key or a local model |
| Marked by | "Stays in ServiceNow" | The AI badge, and "Masked text goes to <provider>" |

**Why this gets approved on the go:** everything ships in one release, and on every screen the reviewer (and the agent) sees
exactly where the boundary is. The no-AI half of every screen is read-only with no egress; the AI half carries the badge, the
preview and the masking, and the organisation can switch it off by policy without losing the Insights half. For that the
Insights half must be useful on its own, so four AI features also get a no-AI version (N9 to N12).

## 2. Screen design

### 2.1 Layout (agreed: the split is inside each screen)

```
+--------------------------------------------------+
| Agent Buddy      dev364920          [Settings]   |  header: which instance
| Ticket | My work | Team | Write | Knowledge      |  the screens, as today
+--------------------------------------------------+
| INC0010001  VPN keeps disconnecting               |  Ticket screen only: ticket at a glance,
| In Progress · 2-High · SLA due in 2h 10m          |  shared by both halves
| Customer waiting 4 d       [Quick actions ...]    |
+--------------------------------------------------+
|  [ Insights ]  [ AI Assist (AI) ]                 |  the split, on every screen that has both
|  Stays in ServiceNow. Nothing is sent anywhere.   |  the rule of the half on show
|                                                   |
|  ...the cards of that half...                     |
+--------------------------------------------------+
```

- The two halves are a switch under the screen title; the choice is remembered per screen. A screen with only one half (My work
  has no AI) shows no switch.
- Both halves follow the open ticket, so switching keeps the context (nothing is read again).
- AI Assist on the Ticket screen groups actions by what the agent is doing (Understand, Reply, Work it, Resolve), shows the 3 or 4
  that fit the ticket's state first, and keeps answers in one answer area at the top of the half.
- The quick-actions bar (in the ticket header) and the "AB" tab on the ServiceNow page offer actions from both halves, each with
  its mark.

### 2.2 Names (agreed)

**Insights** for the no-AI half, **AI Assist** for the AI half. Known risk: ServiceNow's own AI is called "Now Assist"; the AI
badge and the provider line under "AI Assist" keep them apart.

### 2.3 Conventions everywhere (agreed)

- One AI badge on every AI button, tab and answer; never on Insights elements.
- AI buttons say where text goes on hover ("Sends masked text to DeepSeek"); Insights carries "Stays in ServiceNow".
- Names: actions start with a verb ("Summarise ticket", "Draft reply"); views are nouns ("Related tickets", "SLA radar").
- One accent colour per half (the current green for Insights, a second colour for AI Assist), with text labels so colour is never
  the only signal.

### 2.4 Inviting, not cluttered (a hard rule for every screen)

When someone opens Agent Buddy they should want to use it. Today the first look is busy: on a ticket, two rows of navigation,
11 equal action cards, a quick-actions bar that repeats three of them, a footer sentence on every screen, and the answer drawn at
the very bottom; Related is about 3,000 px tall; Team shows about 12 controls before the first number; the first run repeats
"Add an AI key" and "turn on" twice; Settings is one long technical page.

**Principles**

1. **One obvious next step per screen.** The most likely action for this ticket in this state is the one primary button.
2. **Show three, fold the rest.** Lists and action groups show the top 3 to 4, then "Show all (12)".
3. **Answer first.** A result appears where the person is looking (top of the half), never below long lists.
4. **Say it once.** Privacy and "nothing is written to ServiceNow" are said in setup and Settings, then shown as a small shield
   mark with a hover text, not as a sentence on every screen.
5. **Quiet frame.** Header: name, instance, settings icon. The model picker lives in AI Assist settings, not in every header.
6. **Useful when empty.** "Nothing is waiting on you. 3 tickets in your groups are due today." instead of a blank card.
7. **Fast and honest.** Cached content shows at once; a read that takes longer than 3 seconds says what it is waiting for.
8. **Only what your work needs.** Work profiles (2.5) decide which cards and actions appear; "Show everything" stays one click
   away for people who want it.

**Clutter budget (checked on every screen before it is called Done, at 400 px panel width)**

| Rule | Limit |
|---|---|
| Primary (filled) buttons on screen | 1 |
| Buttons visible on one card | 4 at most, the rest under "More" |
| Helper text per card | 1 line; more behind an info mark |
| Same sentence twice on one screen | never |
| Ticket screen, first 600 px | ticket at a glance, quick actions and the top 3 cards; the main action needs no scrolling |
| Clicks from an open ticket | summary 1; reply into the form 2; resolution notes into the form 2 |
| Navigation rows above the content | 2 at most (screens, then the Insights / AI Assist switch) |

Each screen's review shows a before and after screenshot against this budget. V3 adds a five-second test with agents
("what does this do? would you use it?").

```
Ticket screen, AI Assist, an incident In Progress (sketch)
+--------------------------------------------------+
| Agent Buddy   dev364920                  [gear]  |
| Ticket  My work  Team  Write  Knowledge          |
+--------------------------------------------------+
| INC0010001 · VPN keeps disconnecting             |
| In Progress · 2-High · SLA 2h 10m · waiting 4d   |
| ! 9 open tickets on VPN Gateway EU in 2 h        |
+--------------------------------------------------+
| [ Insights ]  [ AI Assist ]   (shield) DeepSeek  |
|                                                  |
|  [ Draft reply ]   Summarise    Next steps   More|
|                                                  |
|  +-- Draft reply -------------------------------+|
|  | Hi Abel, thanks for your patience...         ||
|  | [Insert as customer comment]  Copy  Shorter  ||
|  +----------------------------------------------+|
|  Earlier: Summary (2 min ago)                    |
+--------------------------------------------------+
```

### 2.5 Work profiles (agreed)

Each person sees the functions their work needs. Several profiles can be on at once, because people wear several hats.

| Profile | Suggested when the person has | What it turns on |
|---|---|---|
| **IT service desk / resolver** | `itil` | Incidents and requests in My work; recent changes, known errors, outage spotter on the ticket; routing; IT templates |
| **Request fulfilment** | catalog tasks or requested items assigned | Request status, checklist, approval chasing |
| **Customer service** | `sn_customerservice_agent` | Cases in My work; account at a glance; escalate to engineering; chat; CSM templates |
| **HR service delivery** | HR case roles **and** organisation approval | HR cases; HR brief; HR templates; Strict privacy forced |
| Add-on: **Team lead** | manager of an assignment group | Team screen, shift hand-over, coaching (when the organisation allows it) |
| Add-on: **Knowledge manager** | knowledge roles | Duplicate finder, gap radar, optimise, merge (knowledge search stays on for everyone) |
| Add-on: **Major incident, problem, change** | those roles | Major incident updates, RCA, CAB brief, change conflicts |

- **Suggested from the person's ServiceNow roles and groups at first run**, confirmed by the person, changed in Settings.
- **The ticket decides what is possible, the profile decides what is shown.** A ticket outside the person's profiles still works,
  with a one-line hint: "This is a customer service case. Show Customer service tools?"
- **Policy** can limit which profiles are allowed (for example HR only for the HR group) or lock them for a team.
- What a profile changes: the screens shown, the tables My work reads (fewer reads, faster), the Insights cards and their order,
  the AI Assist actions and quick-action defaults, the template and snippet sets, the default dashboard, privacy defaults.

---

## 3. All functions: what is built and what is planned

Every function of Agent Buddy, built or planned, in one list. This is what we verify, improve and build, row by row.

**Columns.** **Half**: Insights (no AI) or AI Assist. **Profiles**: who sees it by default (2.5): `All`, `IT` (IT service desk /
resolver), `REQ` (request fulfilment), `CSM` (customer service), `HR` (HR service delivery), `Lead` (team lead), `KM`
(knowledge manager), `MPC` (major incident, problem, change). **Before**: what existed before round 3: `Built` (existed and passed the tests on the fake
instance), `Partly` (the core existed but was hidden, limited or elsewhere), `New` (not built). **Real check**: seen working on
dev364920 (`Seen`, `Partly`, `Not yet`, `-` for new). **Status**: see the top of this file.

**Totals:** 99 rows. Built 60 · Partly 10 · New 29. Seen on the real instance: 1 fully, 4 partly, 71 not yet (23 have nothing to see).

### 3.1 Foundation (every screen stands on it)

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| F1 | Setup and turn-on | Insights | All | Built | First-run card, "Turn on for this site", host permission | Offer "Turn on" only on ServiceNow pages ("turn on anyway" for custom domains); exact policy instances on automatically; a refused permission explains the next step; open tabs keep working after an extension update; one Getting started card; "Skip AI for now" | Seen | Ready for review |
| F2 | Settings | Insights | All | Built | Options page (one long page) | Split into Basics and AI Assist; plain words; instance shown in the panel header | Not yet | Ready for review |
| F3 | Record detection | Insights | All | Built | Content script: classic, Next Experience, Workspace, portal | HR child tables recognised as HR; `/task.do` resolves the real type; blank forms detected on every UI | Partly | Ready for review |
| F4 | Reading from ServiceNow | Insights | All | Built | GET-only Table/Aggregate reads with the agent's session | A time limit on every read with "Try again"; session token dropped after a 401 and "sign in again" shown; tables not on the instance hidden, not shown as raw errors | Partly | Ready for review |
| F5 | Insert into the form | Insights | All | Built | Fills one field on the open form; never saves | Edit before Insert; replace or append (no duplicates); the right field per type (problem `fix_notes`/`cause_notes`); pre-check that the field is there; say where text lands and the next step (Save, Post); verified on classic, Next Experience, Workspace composer, portals | Not yet | Ready for review |
| F6 | Quick-actions bar and the "AB" tab on the page | Both | All | Built | Panel bar above the record tabs; tab on the page edge | State-aware actions from both halves, each marked; none from AI Assist when AI is off; the page tab gets an icon and label, sits below ServiceNow's dialogs (today on top of them), is draggable and clear of the Workspace sidebar. Changed 2026-11-05: the quick bar in the panel is gone; the side rail lists every Insights card or every AI action of the ticket (R14), Settings > Side rail hides and orders them; the page tab became the icon dock at the bottom of the ServiceNow page (R10), its actions (up to 4) still chosen in Settings. Changed again the same day (R15): the rail is off unless Settings turns it on, then lists the five and All tools; the per-kind hide and order lists are gone | Partly | Ready for review |
| F7 | Organisation policy | Both | All | Built | Managed policy, enterprise build | `aiEnabled: false` hides every AI Assist half; `disabledSections` hides screens; profile keys (F9); remove unused `autoSignature` and `tabs/Stub.jsx` | Not yet | Ready for review |
| F8 | Activity log and stored data | Insights | All | Built | Settings: activity log, stored data, clear all | "Copy diagnostics" for support (versions, settings without secrets, last errors) | Not yet | Ready for review |
| F9 | Work profiles | Insights | All | New | - | First-run "What do you work on?" pre-filled from roles and groups; Settings; the hint on tickets outside the profiles; policy to allow or lock profiles | - | Ready for review |
| F10 | Quiet frame | Insights | All | Built | Header with provider and model; footer sentence on every screen; three first-run cards | Header with name, instance and a settings icon; the footer becomes a shield mark; one Getting started card; at most two navigation rows | Not yet | Ready for review |

### 3.2 AI Assist foundation (every AI function uses it)

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| AI0.1 | AI settings (provider, key, model, test, limits) | AI Assist | All | Built | Settings page, model picker in the panel header | Its own AI Assist page in Settings; inline key unlock from the panel; DeepSeek checked for real. Done: a locked key is unlocked right in the panel (AI Assist and the Getting started card), same unlock as Settings, nothing kept; the real DeepSeek answers are checked under V2 | Not yet | Ready for review |
| AI0.2 | Privacy shield (masking, preview, never-put-back, HR rules) | AI Assist | All | Built | Firewall, preview dialog | Preview shows ticket data first, fixed rules folded; a short confirmation instead of the full preview every time for look-alike functions; HR records need Strict for every function | Not yet | Ready for review |
| AI0.3 | What is sent (the request) | AI Assist | All | Built | Firewall request builder; every field its own block | One block for short fields; strip signatures, disclaimers, quoted history; shorter shared rules; token estimate and trim per model; tell the model and the agent what was not available; before/after size per function (today: tags 25-63% of the data, prompt longer than the data in 13 of 23) | Not yet | Ready for review |
| AI0.4 | The answer area | AI Assist | All | Built | One answer at a time, at the bottom of the open tab | At the top of the half; several answers kept per ticket and across tab switches; refine (Shorter, More formal, Translate, own instruction); edit before Insert; streaming or elapsed time; "Try again" and "Open Settings" on errors; Copy as the main button for notes to self | Not yet | Ready for review |
| AI0.5 | Ask about this ticket | AI Assist | All | New | - | A free question box on the ticket, through the same masking and preview | - | Ready for review |

### 3.3 Ticket screen: header

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| N1 | Ticket at a glance | Insights | All | Partly | Record header: number, title, kind, state, priority | SLA time left, "customer waiting since", last update, owner, VIP and outage marks; refreshes after Save; holds the quick-actions bar. Done: the header is read again about 1.5 seconds after a Save on the same record (the classic or Next Experience form reloads; on a Workspace, its Save button or Ctrl+S). Changed 2026-11-05: compact (number, title, state / priority / SLA chips; the rest under "Ticket details"); the SLA, customer-waiting and outage facts are the first Insights rows; no quick-actions bar (R14) | Not yet | Ready for review |

### 3.4 Ticket screen: Insights

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| N2 | Related tickets (caller history, solved look-alikes, open duplicates) | Insights | All | Built | Related tab | Collapsed groups with counts; links open in the agent's own UI and never replace the ticket being worked on. Changed 2026-11-05 (R15): the caller's earlier tickets moved to their own card (N30); Related tickets is in All tools | Not yet | Ready for review |
| N3 | Knowledge for this ticket | Insights | All | Built | Bottom of the Related tab | Its own card; "Copy link" to share with the customer | Not yet | Ready for review |
| N4 | Ready to resolve? | Insights | All | Built | Check tab | Clearer name; reads the notes being typed (Next Experience too); each finding links to its fix. Done: on a Workspace page the notes typed and not saved (resolution notes, work notes, comment) are read from their boxes, read only; close code and state stay the saved ones there | Not yet | Ready for review |
| N5 | Request status | Insights | REQ, IT | Built | Request tab (RITM, request, catalog task) | "Who to chase" as one line at the top; checked on real requests | Not yet | Ready for review |
| N6 | Fulfilment checklist (ticking) | Insights | REQ | Built | Checklist tab | Checked on real tasks; ticks kept per task | Not yet | Ready for review |
| N7 | Article checks | Insights | KM | Built | Article tab on a knowledge article | Checked on real articles | Not yet | Ready for review |
| N8 | Chat facts | Insights | CSM, IT | Built | Chat tab | Checked on a real chat | Not yet | Ready for review |
| N9 | Risk signals | Insights | IT, CSM | Partly | Computed inside the AI sentiment feature, never shown | Shown without AI (angry or urgent words, capitals, reopen count, time waiting, VIP); priority mismatch check | - | Ready for review |
| N10 | Where similar tickets went | Insights | IT, CSM | Partly | Solved look-alikes are found in Related; no vote | "4 of 5 solved look-alikes went to Network Support, category Network" | - | Ready for review |
| N11 | Missing details | Insights | IT, CSM | New | Only as the AI "What is missing?" | Rule-based list of empty or vague key fields (CI, impact, error text, contact, steps) | - | Ready for review |
| N12 | Steps that worked before | Insights | IT, CSM, REQ | Partly | Fix lines per look-alike in Related | The fixes of solved look-alikes and matching articles as one list | - | Ready for review |
| N20 | Which email fits | Insights | All | Built | Write > Email (default tab) | Moves to the ticket; a template per email type filled from the ticket (no AI); "Open the email form" in the agent's own UI | Not yet | Ready for review |
| N24 | Ticket journey | Insights | All | New | - | Opened, assigned, reassignments (count and path), state changes, last customer message, SLA events; full field history readability to check | - | Ready for review |
| N25 | Recent changes on this CI or service | Insights | IT, MPC | Partly | Exists for cases and the CAB brief | For incidents too: changes implemented on the same CI or service in the last days | - | Ready for review |
| N26 | Known errors and open problems | Insights | IT, MPC | New | - | Problems and known errors for the same CI or service, workaround first | - | Ready for review |
| N28 | Account at a glance | Insights | CSM | Partly | Reads exist inside the AI account briefing | Open and recent cases, entitlement, priority account, recent changes on its assets, without AI. Done: the organisation names its priority accounts in policy (`priorityAccounts`, ServiceNow has no standard column); a "Priority account" tag on the Account card and in the header, no new read | - | Ready for review |
| N29 | Outage spotter | Insights | IT | Built | "Open duplicates" at the bottom of Related | A banner on the ticket and in My work when the count passes a threshold | Not yet | Ready for review |
| N30 | Caller's other tickets (Same caller) | Insights | All | Partly | The caller group of Related tickets (N2) | Its own card in the "Same caller" row: the caller's earlier tickets, the repeat flag, the last fix that worked; Related tickets keeps the look-alikes and what is open on the same item, so nothing shows twice; finds the employee on an HR case too | Not yet | Ready for review |

### 3.5 Ticket screen: AI Assist

Grouped by what the agent is doing, offered by ticket state first (New: Understand; In progress: Reply, Work it; Resolved: Resolve).

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| AI1 | Understand: Summarise ticket | AI Assist | All | Built | Actions list | Copy as the main button; a name clearly different from AI2 | Not yet | Ready for review |
| AI2 | Understand: Summarise the discussion | AI Assist | All | Built | Actions list | Merge with AI1 or rename | Not yet | Ready for review |
| AI3 | Understand: Mood and escalation risk | AI Assist | IT, CSM | Built | Actions list | Built on N9; not on internal catalog tasks; not inserted as "Mood:" into work notes | Not yet | Ready for review |
| AI4 | Understand: HR case brief | AI Assist | HR | Built | Actions list, Strict mode only | Reaches HR child tables (F3) | Not yet | Ready for review |
| AI5 | Understand: Account briefing | AI Assist | CSM | Built | Actions list | Built on N28 | Not yet | Ready for review |
| AI6 | Understand: Explain this request | AI Assist | REQ, IT | Built | Request tab | Built on N5; the message goes where the requester sees it | Not yet | Ready for review |
| AI7 | Reply: Draft reply | AI Assist | All | Built | Actions list | Not on closed tickets or problem/change tasks; warn on catalog tasks | Not yet | Ready for review |
| AI8 | Reply: Questions to ask | AI Assist | All | Built | Actions list ("What is missing?") | Built on N11; says it goes to the customer | Not yet | Ready for review |
| AI9 | Reply: Email drafts (6 types) | AI Assist | All | Built | Write > Email | Offered from N20 on the ticket; insert into the email body or Additional comments. Done: "Open the email form" carries the draft to that ticket's email form (new tab), where "Insert subject" and "Insert body" fill it; the subject keeps the ticket number; nothing is sent until Send | Not yet | Ready for review |
| AI10 | Reply: Chat reply suggestions | AI Assist | CSM, IT | Built | Chat tab | Checked on a real chat | Not yet | Ready for review |
| AI11 | Work it: Next best actions | AI Assist | IT, CSM, REQ | Built | Actions list | Built on N12; no full preview every time | Not yet | Ready for review |
| AI12 | Work it: Where should this go? | AI Assist | IT, CSM | Built | Actions list (incident, case) | Built on N10; the AI adds the reasoning | Not yet | Ready for review |
| AI13 | Work it: Hand-off brief | AI Assist | All | Built | Actions list | Checked on real tickets | Not yet | Ready for review |
| AI14 | Work it: Escalate to engineering | AI Assist | CSM | Built | Actions list (case) | Checked on a real case | Not yet | Ready for review |
| AI15 | Work it: Major incident updates | AI Assist | MPC | Built | Actions list (every incident, problem, change) | Only on major incidents | Not yet | Ready for review |
| AI16 | Work it: Problem statement / RCA | AI Assist | MPC | Built | Actions list (problem) | Linked incidents and timeline also shown as Insights | Not yet | Ready for review |
| AI17 | Work it: Change / CAB brief | AI Assist | MPC | Built | Actions list (change) | Change conflicts also shown as Insights | Not yet | Ready for review |
| AI18 | Work it: Checklist from instructions | AI Assist | REQ | Built | Checklist tab | Only when N6 finds no steps | Not yet | Ready for review |
| AI19 | Resolve: Resolution notes | AI Assist | All | Built | Actions list | Not on New tickets; replaces instead of appending; right field per type; overlap warning becomes a hint | Not yet | Ready for review |
| AI20 | Resolve: Improve my resolution notes | AI Assist | All | Built | Check tab | Replaces the original instead of appending | Not yet | Ready for review |
| AI21 | Resolve: Knowledge article from ticket | AI Assist | IT, CSM, KM | Built | Actions list | Offered at Resolve; blank article form on every UI | Not yet | Ready for review |
| AI22 | Resolve: Chat summary | AI Assist | CSM, IT | Built | Chat tab | Checked on a real chat | Not yet | Ready for review |
| AI31 | Same caller: Brief me on this caller | AI Assist | All | New | - | What this caller raised before, whether this looks like a repeat, what fixed it last time, what to watch out for; reads the caller's other tickets (at most 10, GET only, the history read N30 uses), no name sent, the check before sending every time; HR cases only with the HR rules. `src/features/packs/caller.js`, `tests/caller-briefing.test.js`, scenario `x` | Not yet | Ready for review |

### 3.6 My work screen (today "My day"): Insights only

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| N13 | My queue | Insights | All | Built | My day (25 per table, 6 tables) | Every open ticket (count, pages, "25 of 40"); all task types and approvals; resolved-but-active folded; "customer replied / waiting on me / waiting on customer"; SLA time left on every ticket; paused SLAs shown as paused; filters with counts; read time, re-read after 5 minutes; a click opens the ticket on the Ticket screen | Not yet | Ready for review |
| N14 | Unassigned in my groups | Insights | All | New | - | The group queue, oldest first | - | Ready for review |
| N27 | Follow-ups due | Insights | All | New | - | Waiting on the customer past N days, customers not updated for N days, each with its template; "customer replied" when they answer; outage banners for my tickets | - | Ready for review |

### 3.7 Team screen

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| N15 | Team dashboards (overview, SLA radar, fulfilment, workload, quality) | Insights | Lead | Built | Team section | Compact layout for 400 px; one export menu per dashboard; real team groups (active, "25 of 41 used"); HR and change-task tables; one sign-in banner; relative due times; ServiceNow time zone; default view by role | Not yet | Ready for review |
| N16 | Shift hand-over (tables) | Insights | Lead | Built | Team > Shift handover | Complete without AI; checked on real data | Not yet | Ready for review |
| N17 | Report builder, saved dashboards, export, full page | Insights | Lead | Built | Team > Customize, full-page dashboard | Dashboards tied to an instance; layout export/import; a policy default dashboard. Done: policy `defaultDashboard` (a saved layout file) is the first dashboard of anyone without one, and "Add your organisation's dashboard" for the rest; never locked | Not yet | Ready for review |
| AI28 | Hand-over note | AI Assist | Lead | Built | Team > Shift handover | Written from N16's tables | Not yet | Ready for review |
| AI29 | Explain this dashboard | AI Assist | Lead | Built | Team > Explain this dashboard | Checked on real data | Not yet | Ready for review |
| AI30 | Coaching snapshot | AI Assist | Lead | Built | Team, off unless the organisation turns it on | Stays policy-gated (HR / works-council sign-off) | Not yet | Ready for review |

### 3.8 Write screen

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| N21 | Snippets | Insights | All | Built | Write > Snippets (per browser) | Team and organisation snippets (policy list); file export/import; optional sync; insert into any field; real `/shortcut` expansion or rename | Not yet | Ready for review |
| N22 | Safe-to-send check | Insights | All | Built | Runs on text Agent Buddy inserts | "Check my comment" on typed text; internal phrases from policy | Not yet | Ready for review |
| AI23 | Rewrite (7 modes) | AI Assist | All | Built | Write > Rewrite | Also offered on any AI answer | Not yet | Ready for review |
| AI24 | Notes to ticket | AI Assist | IT, CSM | Built | Write > Notes to ticket (blank classic form only) | Button to open a blank incident or case; suggest caller, category, group | Not yet | Ready for review |

### 3.9 Knowledge screen

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| N23 | Knowledge search | Insights | All | New | - | Search box for any article, same ranking as N3, "Copy link" | - | Ready for review |
| N18 | Duplicate article finder | Insights | KM | Built | Knowledge > Duplicates | Limits said up front; page through more; body text inside a cluster; export | Not yet | Ready for review |
| N19 | Knowledge-gap radar | Insights | KM | Built | Knowledge > Gaps | Scope by groups or category; "500 of 12,400"; export | Not yet | Ready for review |
| AI25 | Article optimise | AI Assist | KM | Built | Article tab | Checked on real articles | Not yet | Ready for review |
| AI26 | Merge duplicate articles | AI Assist | KM | Built | Knowledge > Duplicates | Checked on real articles | Not yet | Ready for review |
| AI27 | Gap outline | AI Assist | KM | Built | Knowledge > Gaps | Checked on real data | Not yet | Ready for review |

### 3.10 After the screens: proof, release, quality

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| V1 | Full real-instance check | - | - | Partly | ~235 open questions in `docs/live-questions/` | Answer them on dev364920 (CSM, HR, chat tables; Workspace and portal Insert; time zones) | Partly | Needs you |
| V2 | AI answer quality | - | - | New | Tested only against a stub | Every AI function on real tickets with DeepSeek | - | Needs you |
| V3 | Prove it | - | - | New | - | Shadow a few agents; baseline numbers before rollout (reassignment, reopen, time to first response, customer-update gap); compare after; five-second test of each screen | - | Needs you |
| R1 | CI | - | - | New | None | Unit tests, compile check and e2e on every push. Done: `.github/workflows/ci.yml`; on GitHub the checks job (unit, compile, build, traceability, audit) passes. The e2e job now passes on `ubuntu-latest` too (1,010 pass, run 41265048867); still allowed to fail until it has passed a few times | - | Ready for review |
| R2 | Version and release package | - | - | New | Version 0.1.0, no packaging step | One release with both halves; zip; changelog | - | Ready for review |
| R3 | Deployment | - | - | Partly | `docs/deployment.md`, policy samples | Self-hosted install (decided 2026-11-01: your own web server, installed and updated by policy). Done: `scripts/selfhost.js` (signing key, signed CRX3 package checked against one Chrome made itself, `update.xml`, policy files with the id and address filled in), `docs/deployment.md` "Self-hosted install". Not tried on a managed computer | Not yet | Ready for review |
| R4 | e2e stability | - | - | New | Scenario b timed out once under load | Find out whether it is flaky and fix it | - | Ready for review |
| R5 | Performance | - | - | New | Unminified: 380 KB content script on every ServiceNow page, 1.35 MB panel | Minified release: `build.js --minify` is 43% smaller (content script 494 KB to 284 KB); `npm run package -- --minify` also writes a readable copy for the security review; `npm run repro -- --minify` rebuilds it byte for byte. Each bundle carries only the Arabic entries it can ask for (the script on every ServiceNow page grew by 90 KB, not 700 KB) | - | Ready for review |
| R6 | Accessibility, dark mode, shortcuts, languages | - | - | Partly | Dark-mode tokens and focus fixes exist; no keyboard shortcuts | Done: accessibility and dark-mode audit (scenario `zz`), keyboard shortcuts (`Alt+Shift+1/2/3`, Mac `Control+Shift+1/2/3`: open the panel, summarise, draft a reply; Settings lists them), Arabic with right-to-left layout (below, R8) | Not yet | Ready for review |
| R7 | e2e harness: attach to a new tab before its first request | - | - | New | Record links from the Ticket screen open in a new tab; the harness can miss its first reads, so the coverage check tolerates up to 5 plain GET reads (listed) | Attach through the DevTools protocol before the tab starts (auto-attach, wait for debugger), then drop the tolerance. Done: new pages are logged from their start, and every http(s) request is logged in the browser (held and continued at once), so the reads a page makes as it closes or navigates are seen too; coverage has zero tolerance (0 missing in 4 of 4 full runs) | - | Ready for review |
| R8 | Arabic (and a language setting) | - | - | New | English only | Settings > Language (English, العربية, same as the browser). 2,760 texts in Arabic across the panel, Settings, the Team page and the bar on the ServiceNow page; right to left; masking that understands Arabic digits, Arabic labels and Arabic spellings of a name (`tests/pii-arabic.test.js`); AI answers in the ticket's language (default) or the panel's (`Language of AI answers`). Checked by `tests/i18n.test.js` and scenario `zy` (every screen: no English left, nothing sideways at 320 px, the accessibility audit) | Not yet (`docs/live-questions/i18n.md`) | Ready for review |
| R9 | Look and feel, colours, command palette | - | - | New | Plain text header, text-only action pills, a title cut off at one line, no way to switch light and dark, no palette | Built (steps 1 to 3 of the plan you approved on 2026-11-01): a real header (mark, name, instance, four buttons), one icon set, the ticket at a glance with the title on two lines and state / priority / SLA chips, quick actions as icon tiles; Settings > Appearance (Same as the computer, Light, Dark) for the panel, Settings, the Team page and the bar on the ServiceNow page, with a sun / moon button in the header; the command palette (`Ctrl+K`, Mac `Cmd+K`, or the header button): screens, every AI action of the open ticket, Insights cards, the two halves, Settings, colours, languages, in English and Arabic. Scenario `zx`, `tests/palette.test.js`. Since then: the redesign (R13) restyled My work, Team, Write, Knowledge and Settings; the quick action tiles gave way to the side rail (R14) | Not yet (`docs/live-questions/look.md`) | Ready for review |
| R10 | Icon docks: the page bar and the panel screens | - | - | New | A small green tab on the right edge of the ServiceNow page that opened a 236 px card of text buttons; text tabs for the five screens under the header | Built (plan agreed 2026-11-03: both, page first). The page bar is a pill at the bottom centre: the Buddy mark and one round icon per action (the panel's own icons, AI spark on AI actions), the name at once on hover and on the keyboard, folds to the mark, drag or arrow keys move it along the bottom, remembered in the page; nothing it may do changed (closed shadow root, trusted clicks, visibility check, below the page's dialogs). The panel's screens are an icon dock at the bottom centre, the screen on show filled, names on hover and focus, inert behind the palette, mirrored in Arabic (since 2026-11-05 a full-width bar with the names under the icons, R14). Scenarios `y`, `z`, `zy`, `zw`, `tests/bar-logic.test.js`, `tests/icon-dock.test.js` | Not yet (`docs/live-questions/quickbar.md` 19 to 22, `look.md` 8 to 10) | Ready for review |
| R11 | Answer formats: sections, style, length and extra instructions for AI answers | - | - | New | One fixed prompt per AI action; the only AI output setting was the language | Built (decisions 2026-11-03: section builder plus extra instructions; Settings and under the action in the panel; team formats from the start). Summary, hand-off brief and discussion catch-up take named sections, a style and a length; 20 actions take extra instructions; the actions the panel reads back or the customer reads keep their labels and rules; `orgFormats` publishes or locks one for the team. Scenarios `zv`, `zy`, `zz`, `tests/formats.test.js`, `tests/formats-editor.test.js` | Not yet (`docs/live-questions/formats.md`) | Ready for review |
| R12 | Audit: about 110 defects fixed | - | - | New | Green tests, but defects they did not catch | Seven read-only reviews (security core, the page, feature logic, reports, the Ticket screen, the other screens with Settings, build and tests) found about 110 defects; all fixed in five phases: privacy, policy and the AI firewall (24); the right ticket, fresh data, no races (31); names, dates and numbers (37); build, tests and CI (`npm run verify`, ESLint); 3,645 lines of unreachable code removed and Settings split into folders. `docs/review/audit-2026-11-04.md`. Still yours to decide: one meaning of a ticket's state across five classifiers; one reader of "Label: text" answers | - | Ready for review |
| R13 | Redesign: a calmer, clearer panel | - | - | New | The look of round 3 and R9; you said the UI and layout were not great | From the mockup you approved ("calm and focused"): one accent colour, a grey AI mark, no boxes in boxes; the check before sending readable, hidden values as chips; My work and Team without repeated numbers; Write and Knowledge with the articles for the open ticket; Settings as a menu with switches. Found on the way: a card that could not read its data said "all clear"; fixed | Not yet | Ready for review |
| R14 | Side rail: every option of the screen on the right, the screens at the bottom | - | - | New | The ticket's first screen was the facts, Needs you now, Summarise and a large quick-actions block; Insights and AI Assist started near the bottom | From the mockup you approved: the Ticket screen's top compact with Insights \| AI Assist under it; a rail on the right lists everything for the half on show (every Insights card, a dot when one needs you; every AI action, a click starts it with the preview first), names on hover or with "Show names"; My work, Team, Write and Knowledge list their sections there; the screens in a bar at the bottom with their names; Settings > Side rail hides and orders the rail per kind of record and half. Right side panel only, as you decided. `docs/rail-layout.md`; scenarios `x`, `zw` | Not yet | Ready for review |
| R15 | Focus layout: five pain points per tab, everything else in All tools | - | - | New | Every Insights card and every AI action on the Ticket screen and in its rail; your leaders said too many features, cluttered | From the mockup you approved: Insights shows five rows (understand the ticket, find the fix, the same caller, reply, close well), each with its one line and a dot when it needs a look, opening in place; AI Assist shows the five actions for them, one filled Start for the ticket's state; the rest in All tools (the palette, grown into a sheet with groups: more for this ticket, Go to, Panel), opened from the header, Ctrl+K or "More for this ticket" at the end of each half; "Ask about this ticket" opens from there; the colours button left the header; the side rail is off unless Settings turns it on (then the five and All tools). `docs/focus-layout.md`; scenarios `x`, `zx`, `zw` | Not yet | Ready for review |
| R16 | More browsers, phase 1: the browser layer, the sender check, one build per browser | - | - | New | Chrome and Edge only: the service worker called `chrome.sidePanel` itself; the sender check accepted only `chrome-extension://<id>`; one build, `dist/` | Built and checked 2026-11-06, committed (not pushed yet); the Chrome e2e still passes 1,193 of 1,193. `src/lib/platform.js` is the only code that knows how browsers differ (which panel, how it opens, the toolbar button, the origin of the extension's pages, the shortcuts page; by what the API offers, never the user agent); the sender check compares the sender's origin exactly with the origin of the extension's own pages from `runtime.getURL('')` (Chrome and Edge still exactly `chrome-extension://<id>`); `node build.js --browser chromium\|firefox`, the browser table and the Firefox manifest in `scripts/lib/browsers.js`; the compile check covers both; `repro-check --browser firefox`; build rule 12. `tests/platform.test.js`, `tests/senderCheck-content.test.js`, `tests/manifest-firefox.test.js` | Not yet | Ready for review |
| R17 | More browsers, phase 2: Firefox | - | - | New | None | Built and checked 2026-11-06, committed (not pushed yet); `npm run e2e:firefox` passes 56 of 56. The run found one Firefox bug, fixed: the page bridge could not read the content script's request (`src/content/pageBridge.js`, a copy made with Firefox's `cloneInto`; `tests/pageBridge-firefox.test.js`). `dist-firefox/` for Firefox 128 or later: the sidebar, the background as an event page, the gecko id `agentbuddy@agentbuddy`; the dock with the sidebar closed asks for the toolbar button and the action starts if the panel opens within 30 seconds (your decision); Settings shows "Change the shortcuts" only where Firefox can open its page (137 and later); "Copy diagnostics" names Firefox; policy files (`docs/review-pack/policies-firefox/`) and the self-hosted install through AMO signing (`docs/deployment.md`, "Firefox"); `npm run e2e:firefox`. Two Firefox limits the run found (its two warnings; `docs/security.md` 3A and limit 17): Firefox cannot close `storage.local` to the content script (no `setAccessLevel`; the AI key is never there), and a site whose address has a port cannot be turned on (ServiceNow instances have none) | Not yet (`docs/live-questions/firefox.md`) | Ready for review |
| R18 | More browsers, phase 3: Edge on the real instance | - | - | New | The same package as Chrome; the Edge checks were scattered over `docs/live-questions/` | Walk `docs/live-questions/edge.md` in Edge on dev364920 with you (the dock opening the side panel, shortcuts, right to left, storage access, a managed Edge) | Not yet (`docs/live-questions/edge.md`) | Needs you |
| R19 | More browsers, phase 4: Safari | - | - | New | None | The panel in a window of its own (the places are marked "Safari" in `src/lib/platform.js`), Apple's converter in Xcode, an Apple developer account. Waits for a Mac with Xcode | - | Agreed |
| R20 | More browsers, phase 5: release per browser | - | - | New | `npm run package`: one zip, for Chrome and Edge | Done: `npm run package` writes `release/agentbuddy-<version>.zip` (Chrome and Edge) and `release/agentbuddy-<version>-firefox.zip`. Left: store accounts when you release (Chrome Web Store $5 once, Edge Add-ons free, addons.mozilla.org free, Apple $99 a year); for addons.mozilla.org, what `data_collection_permissions` declares (it is required for a new submission; masked ticket text goes to the AI endpoint the person or organisation chose), that AMO accepts an add-on id from one account only (the first to submit it), and that AMO asks for the source because the build bundles the files; pull everything into the ifBash copy (`D:\ifBashAgentBuddy`, `git pull agentbuddy main`) | - | Partly built |
| R21 | Round 4, "Loved": Phase 0 fixes and the pain points ServiceNow cannot solve, inside the five | - | - | New | - | Built 2026-11-06/07 by seven agents (`docs/round4.md`), NOT committed. Phase 0: Unicode/Arabic keywords and rules (`src/lib/similar.js`, `src/insights/{missing,emailTemplates}.js`, `src/itsm/sentiment.js`, `src/checks/checklist.js`); security/vulnerability/GRC tables sensitive by default (`src/context/kinds.js`, `src/policy/policy.js`, the firewall); refusals with reasons (`src/context/access.js`, `src/content/tableApi.js`). New: since you last looked (`src/lib/lastViewed.js`, policy `rememberLastViewed`), Translate the caller's message (`translate-message`), error codes and solved-before-by (`src/insights/{errorCodes,solvedBy}.js`, op `fixCodeSearch`), reply checks and the caller's language (`src/safeSend/replyChecks.js`), close code and repeat warning (`src/insights/closeCode.js`), Prepare to close (`prepare-close`, two-field Insert: build rule 1's second exception), Undo after every Insert (bridge version 4), My work "At risk" (`src/mywork/risk.js`). Tests `tests/{round4-shared,languages-*,reads-*,fix-*,understand-*,close-*,mywork-risk,reply-*}.test.js` | Not yet | Ready for review |

---

## Decisions

| Date | Decision |
|---|---|
| 2026-10-30 | Plan and decide together; no code changes before the plan is agreed. |
| 2026-10-30 | Quick real-instance check first: dev364920, impersonating `itil`, DeepSeek, in your own Chrome. |
| 2026-10-30 | The plan and tracker live in the repo (this file). |
| 2026-10-30 | Split everything into without AI and with AI; improve what exists first; make it extensive enough to be approved on the go. |
| 2026-10-30 | The split is **inside each screen** (not two top-level sections). |
| 2026-10-30 | Names: **Insights** (no AI) and **AI Assist** (AI). |
| 2026-10-30 | Conventions in 2.3 (AI badge, where text goes, verb/noun names, one colour per half) agreed. |
| 2026-10-30 | **One release** with both halves, not staged. |
| 2026-10-30 | Pain-point analysis done (`docs/agent-pain-points.md`): 37 daily pain points across 8 roles mapped to the plan; 6 new Insights items (N24 to N29) and V3 added. |
| 2026-10-30 | **Inviting, not cluttered** is a hard rule: principles and a clutter budget per screen (2.4), with before/after screenshots at each review. |
| 2026-10-30 | Work profiles agreed (2.5): IT, request fulfilment, customer service, HR, plus add-ons for team lead, knowledge manager, major incident/problem/change. Several at once (tick boxes); suggested from ServiceNow roles and groups and confirmed by the person; a ticket outside the profiles still works, with a hint. |
| 2026-10-30 | Integration fix: the six AI email drafts (AI9) were unreachable once the Email tab left Write; they are now on the Ticket screen's AI Assist under Reply, only the types that fit the ticket's state, Copy first. |
| 2026-10-30 | **Build everything planned now** ("implement whatever has been planned and make the best UI/UX"), with as many agents as useful. Eight agents in parallel with fixed file ownership (`docs/round3.md`); the lead builds the frame and integrates. Not in this round: R3 deployment path, R5 performance, R6 accessibility/shortcuts (keyboard shortcuts need a manifest change). |
| 2026-10-31 | **Finish everything** that was partly built: N1 (refresh after Save), N4 (notes typed on a Workspace), N17 (organisation dashboard: policy `defaultDashboard`), N28 (priority accounts: policy `priorityAccounts`, a list of account names, since ServiceNow has no standard column), AI0.1 (unlock the key in the panel), AI9 (email draft into the email form, which opens in a new tab; the subject keeps the ticket number), and R7. R3, R5 and R6 stay agreed for later. |
| 2026-11-01 | **Push round 3 to GitHub** (`main`, as for every earlier round). The MohammedBasheerAhmed login got the `workflow` permission so the CI file could be pushed. |
| 2026-11-01 | R3, R5 and R6 were held back from round 3 by Claude, not by you; they wait for three decisions (store or self-hosted, minify, shortcuts and languages). On "continue", Claude asks those first and meanwhile builds R1 (e2e on GitHub) and the accessibility and dark-mode part of R6. |
| 2026-11-06 | **Agent Buddy in Chrome, Edge, Firefox and Safari, in five phases** (approved): 1 the browser layer, the sender check and one build per browser; 2 Firefox; 3 Edge checked on dev364920 with you; 4 Safari (its panel in a window of its own); 5 release packages per browser, the documents, the pull into the ifBash copy. Phases 1 to 3 first; Safari waits until you have a Mac with Xcode. One source; one package for Chrome and Edge (`dist/` unchanged), one for Firefox. |
| 2026-11-06 | Firefox, a click on the dock while the sidebar is closed (approved): the dock shows the existing "Click the Agent Buddy button in your browser toolbar" note, and the action starts if the panel opens within 30 seconds. |

## Baseline (2026-10-30, before any change)

| Check | Result |
|---|---|
| Unit tests (`node tests/run.js`) | 2291 pass, 0 fail |
| Compile check (`node scripts/check-compile.js`) | all entries ok |
| End-to-end, fake ServiceNow + stub AI (`node e2e/run.js`) | 894 pass, 0 fail, 0 warnings; a second run under load had scenario b time out once (R4) |
| Real instance dev364920, Next Experience, user `itil` (no admin) | Turn-on and the permission prompt work in real Chrome; content scripts load; the "AB" tab shows on an incident form, on top of ServiceNow's own dialog; the form iframe is reachable (`window.frames['gsft_main'].g_form`) although it sits in a shadow root; the session token is readable |
| Not yet seen on the real instance | The side panel on a real record, a real DeepSeek call, Insert into a real form, My day / Related / Team with real data |

## Progress log

| Date | What happened |
|---|---|
| 2026-10-30 | Baseline checks; screenshot tour of every panel screen; two read-only code reviews; first real-instance check; exact AI payloads captured for 23 functions; plan written and restructured: the split inside each screen (Insights / AI Assist), one release, conventions agreed. Pain-point analysis added new items N24 to N29 and V3. No source code changed. |
| 2026-10-30 | **Round 3 built.** Eight agents in parallel (docs/round3.md) plus the lead: the frame (screens, Insights / AI Assist, profiles, policy keys), Ticket Insights (17 cards), AI Assist (grouped state-aware actions, answer area, preview, ask), Insert, what is sent (34% smaller on the fixtures), My work, Team, Write, Knowledge, setup and settings, the page tab, CI and release packaging. Unit tests 2,666 of 2,666 pass; the full end-to-end run in real Chrome 937 of 937 (fake ServiceNow, stub AI). Integration fixes by the lead: AI email drafts brought to the Ticket screen, one shared AI button style, organisation phrases for AI inserts, folded cards fill their summaries, e2e helpers for the new screens. Not yet seen on the real instance (V1). Nothing committed yet: waiting for your review. |
| 2026-10-31 | **Partly built rows finished.** Four agents plus the lead: the header follows a Save (N1), notes typed on a Workspace count in Ready to resolve (N4), organisation dashboard and priority accounts through two new policy keys (N17, N28), the key unlocked in the panel (AI0.1), AI email drafts inserted into the email form (AI9), and an e2e harness that logs every request from the start to the end of each page with zero tolerance (R7). Status: 78 ready for review, 3 need you (V1 to V3), 3 agreed for later (R3, R5, R6), none partly built. Unit tests 2,725 of 2,725; the full end-to-end run 965 of 965, twice in a row. Nothing committed yet. |
| 2026-11-01 | **Pushed to `main`:** `62b4d42` (round 3, 386 files); `6e93694` (CI file fix: GitHub refused the whole workflow because a job-level `env` used `runner.temp`); `61fb3c7` (the review map `docs/review-pack/traceability.md` regenerated; CI's check had found it stale). First CI run on GitHub: the checks job passes, the e2e job (allowed to fail) 265 pass, 21 fail on Linux (R1 left as partly built). Next: V1 on dev364920. |
| 2026-11-01 | **R1 and the accessibility half of R6 built** (`f7c30a4` to `f55fa1d`). The e2e job fails on Linux because headless Chrome makes the popup that holds the panel the last focused window, so the panel read itself; found with a focus log (two guesses were wrong first: keeping the main window focused, and bringToFront), fixed by taking the main window's focus away and giving it back. The e2e run now passes on GitHub: 1,010 of 1,010. New scenario `zz` audits every screen in light and dark in the real browser (contrast, names, labels, focus, target size, reduced motion, 320 px) and found two faults, fixed: no focus ring on the selected Insights / AI Assist tab, and a tab panel named by a tab that does not exist on one-half screens. Unit tests 2,729 of 2,729. Still waiting for your three decisions (R3, R5, rest of R6). |
| 2026-11-01 | **Arabic, shortcuts, self-hosted install and the minified build** (`4038b82` and the commits around it). You said: self-hosted for now; Arabic as well as English; Mac and Windows, Chrome and Edge; do all steps; take the best approach; AI answers in the ticket's language and the panel's. Built by Claude with four parallel workers (one per area of the panel) and a one-off codemod for the first 756 texts; every text has an Arabic entry and a test keeps it so. Unit tests 2,784; end-to-end 1,057. Not seen by anyone who reads Arabic yet: the wording is the model's (glossary in `docs/i18n-arabic.md`). |
| 2026-11-01 | **Look and feel, colours and the command palette (R9).** You said the UI/UX was not great against NowBuddy and SN Utils and approved steps 1 to 3 ("go ahead"). Claude rendered NowBuddy's own preview and the panel side by side, then built the header, the icon set, the glance chips and tiles, the theme setting (panel, Settings, Team page, page bar) and the palette. Scenario `zx` (40 checks), `tests/palette.test.js`. The rest of the screens wait for your look at the real panel. |
| 2026-11-03 | **Icon docks (R10).** You said the small side bar was not looking great and should be in the centre at the bottom, with an icon for each function that names itself on hover. Claude read the bar and the panel, found two candidates (the tab on the ServiceNow page; the panel's screen tabs), and you chose both, page first, with the dock folding to a small pill. Built the page dock (phase 1, `977df81`) and the panel dock (phase 2); scenarios `y`, `z`, `zy`, `zw` and the full run of 1,128 checks passed. |
| 2026-11-03 | **Fix after your report ("Nothing was started: something on the page was covering the bar").** Reproduced on dev364920 in the Next Experience view: hover an icon, press it, refused. Cause: the hover name's drop shadow reached over the icons and Chrome's visibility check counts a shadow as covering (my tests pressed too fast for it to notice). Fixed (small shadow, wider gap, thinner focus ring), and a hidden dialog in the page no longer hides the dock. Scenario `z` hovers before pressing; `tests/bar-logic.test.js` guards the stylesheet. |
| 2026-11-03 | **Answer formats (R11).** You asked whether the summary can follow a format you choose ("issue, key actions performed"...) and whether the other AI actions can be customised too. Claude read how the prompts are built (one fixed prompt per action in `src/features/packs`), found that five actions are read back by the panel and four are read by customers, and proposed: a section builder plus extra instructions, in Settings and under the action in the panel, and team formats through the policy. You chose all three, team formats from the start. Built `src/formats/formats.js` (the default format builds the fixed prompt word for word, pinned by a test), the editor, the Settings section, the panel link, the `orgFormats` policy key (schema, checks, docs), Arabic; unit 2,837 and the full run of 1,152 checks passed. |
| 2026-11-04 | **Audit, then fixes in five phases.** You asked to find the bugs and defects, fix them all, and keep the code to best practice and easy for developers. Seven read-only reviews (security core, page integration, feature logic, reports, the Ticket screen, the other screens with Settings, build and tests) found about 110 defects that the green tests did not catch; Claude re-checked the worst of each by hand. You chose: all five phases, one local commit each (no push until you say), delete unreachable code with its tests, add ESLint. |
| 2026-11-04 | **Audit phase 4, first half: build, tests and CI.** `npm run verify` (the CI gates in one command), `npm ci` gives the e2e its puppeteer-core (pinned), a filter or scenario id that matches nothing fails, the Windows-blind read-only test scans again, CPU-time timing tests, `.gitattributes` (same bytes on Windows), CI on Windows and e2e on the minified build, React licence files in the release, Node 22.12 pinned, README and review-pack README brought up to date. |
| 2026-11-04 | **Audit phase 1: privacy, policy and the AI firewall.** 24 findings fixed, among them: invisible characters that hid an email or a card number from masking, people past the 30th sent unmasked, "Local only" not stopping Test connection, the policy guard comparing dot-walked column names with table names, the check before sending reused across tickets, answers kept in memory after "Clear everything". Unit 2,909 of 2,909; the full end-to-end run 1,161 of 1,161. |
| 2026-11-04 | **Audit phase 2: the right ticket, fresh data, no races.** 27 findings fixed plus four found on the way: the Ticket header and Insights summaries tied to their record, "Ready to resolve?" in the quick bar (it pointed at a card that does not exist), the palette over a hidden ticket or a preview, stale queues and knowledge results after switching sites, Settings' key line and profile boxes, "Clear everything" (every site, its outcome shown, carried drafts and card reads forgotten), the page bridge replaced after an update without a page reload, `task.do` forms. One behaviour change: the follow-up period chosen in My work is now the saved setting. Unit 2,971 of 2,971; the full end-to-end run 1,161 of 1,161 (two quick-bar checks now expect "Ready to resolve?"; "Save format" now waits for the page to show the saved format). |
| 2026-11-04 | **Audit phase 3: names, dates and numbers.** 33 findings fixed plus four found on the way. The worst: matching a note's author to the customer kept only a to z, so an Arabic, Cyrillic or Chinese name was never the customer ("Ready to resolve?" said nobody was waiting); now one shared module (`src/context/identity.js`) replaces six drifting copies. Also: two journal clocks sorted as one, the Workload widget breaking for teams over 12, the SLA radar counting tickets with no SLA problem, Quality and per-person Open disagreeing with the Open tile, averages drawn as shares, "List<String>" cut out as HTML, the snippet greeting's first name, "Use the standard format" not holding. Found on the way: the custom report editor crashed as it opened (a state variable hid the text function; scenario `s` now opens it), a quadratic slowdown in stripping HTML, and scenario `x` was not self-contained (without confirmed profiles it fell back to the set-up steps; it failed 2 in 10 run alone, on the phase 2 build too). Unit 3,022 of 3,022. |
| 2026-11-04 | **Audit phase 5, first part: unreachable code removed** (3,645 lines: panel views no screen shows, the "myday" read, dollar spend caps nothing could set, provider tool-use code, about 25 unused exports, 133 Arabic entries). Unit 2,966. You asked why it was taking so long (about 4 hours); Claude explained (scale, two full checks per phase, about 40 minutes on flaky end-to-end runs) and you chose to finish all of it. |
| 2026-11-04 | **Audit phase 4, second half: ESLint and a dependable end-to-end run.** `npm run lint` (in `verify` and CI), 302 findings fixed, build rule 2 checked by lint. Two scenario checks that could not fail (a backspace where a word boundary was meant) fixed. The coverage check's occasional failure: the harness dropped a read when Chrome used a request id again in a new renderer process (taken for a second report of an earlier request); fixed, and the fake instance keeps its connections open. Unit 2,968 of 2,968. |
| 2026-11-04 | **Audit phase 5, second part: easier to work on.** `src/options/Options.jsx` split (1,484 lines to a 187-line root, folders `provider/`, `basics/`, `data/`, one `useSaveSetting` hook for six copies); one copy each of the Luhn check, the export formula guard, the id/table/field patterns, the group search, the copy helper, the preview style and the Insert findings; same-named functions with different meanings renamed; the audit written up (`docs/review/audit-2026-11-04.md`) with the decisions left to you. Unit 2,968 of 2,968. |
| 2026-11-05 | **Redesign: a calmer, clearer panel.** You said the UI/UX and layout were not great; Claude photographed every screen at 400 px, listed what made it unattractive, made a mockup (canvas above), you chose "calm and focused" and "go ahead". Six agents in parallel from one spec: tokens and shared styles (one accent, grey AI mark, no boxes in boxes), the Ticket screen (Needs you now, one next step, Insights as one list, AI Assist rows), the check before sending (readable, hidden values as chips), My work and Team (no repeated numbers), Write and Knowledge (articles for the open ticket), Settings (a menu, switches). Found while integrating: a card that could not read its data said "all clear" and dropped out of sight; fixed. Unit 3,007; end-to-end 1,169 of 1,169 with the accessibility audit in light, dark and Arabic. |
| 2026-11-05 | **Screens at the bottom, every option in a side rail.** You said the Ticket screen's first screen was the ticket, Needs you now, Summarise and a big quick-actions block, with Insights and AI Assist near the bottom. Mockup (https://claude.ai/artifact/WMmZMaVbxigc1WP3UrUgj3) and your calls: right-side panel only (no console-style docking); the screens stay at the bottom; "the right side has all the options" for the half on show, on every screen. Lead: the rail (`src/sidepanel/shell/SideRail.jsx`, `railStore.js`), the bar of screens, `src/features/railLayout.js`, settings `railNames`/`railLayout`/`railByState`. Three agents in parallel from `docs/rail-layout.md`: the Ticket screen (compact top with "Ticket details", the SLA/customer/outage facts as the first Insights rows, no next step and no quick bar, every card and every AI action in the rail, one card alone), the other screens (their sections in the rail), Settings > Side rail (hide and order per kind and half; the page tab's actions). Found while integrating: the rail's own list scrolled "Show names" out of sight with 16 AI actions, and long names were cut; fixed (the list scrolls, the button stays at the foot, names wrap). Unit 3,050; end-to-end 1,169 of 1,169 (x and zw rewritten). |
| 2026-11-05 | **Pushed to `main`** (`8de6fc4..336e517`: the audit, the redesign and the side rail, held locally until you said "push to github"); CI run 41964561739 passed all four jobs (checks on Linux and Windows, end-to-end on the build and on the minified build). Table section 3 brought up to date: rows R12 (audit), R13 (redesign) and R14 (side rail) added, F6, N1, R9 and R10 say what the side rail changed; the functions page (https://claude.ai/artifact/KSd7hDgkEyR5RR7d8q7iQX) shows all 91 rows. |
| 2026-11-05 | **Five pain points first, everything else in All tools (R15).** You showed Agent Buddy to your leaders: "looks promising but has too many features and looks cluttered"; solve the main pain points, three to five at most, and keep the rest separate. You chose the five (understand the ticket, find the fix, raised by the same caller, reply, close well), that every function stays "through some other way", and that the bottom bar keeps its five screens with five in each tab. Mockup boards "Focused" and "All tools", approved ("approved go ahead"). The lead wrote the shared pieces (`src/features/focus.js`, the All tools opener, launch ids `show:<card>` and `ask:ticket`, icons, `docs/focus-layout.md`); three agents in parallel built the Ticket screen with the new card N30, the new AI action AI31 ("Brief me on this caller"; found on the way: on an HR case the employee is listed only as the subject person, so a plain caller lookup found nobody; both now use one `callerOf`), and All tools with the header and Settings (`railShow`, the per-kind rail lists removed). Team needed no change (its dashboards have five sections or fewer). Found while integrating: All tools listed actions without the ticket's header and without the checklist's read (it missed the major incident updates on a priority 1 incident, and offered the checklist where the instructions have steps); the Ticket screen now hands both over. Unit 3,118; end-to-end 1,193 of 1,193. |
| 2026-11-06 | **More browsers, phases 1 and 2 built and committed (R16, R17).** You asked for Agent Buddy in Chrome, Edge, Safari and Firefox (clients use different browsers) and approved five phases. Built with agents in parallel: the browser layer and the sender check (the old check would have refused Firefox's own sidebar: its pages are `moz-extension://<random id>`, not the add-on id), one build per browser family, the Firefox manifest, the Firefox policy files and self-hosted install, an automated run in real Firefox, and the documents (`docs/security.md` 3A, the review pack, README, build rule 12, contracts, `docs/live-questions/firefox.md` and the Edge checks gathered in `edge.md`). The integration check: lint, the compile check for both browsers, traceability and Arabic pass; unit tests 3,181 of 3,182 (the one failure is the date-bound ticket-rail test, which fails the same without these changes); e2e Chrome 1,193 of 1,193; e2e Firefox 56 of 56 with the two known Firefox limits as warnings. The same day, separately: the ifBash-branded copy at `D:\ifBashAgentBuddy` for a client demo. |
