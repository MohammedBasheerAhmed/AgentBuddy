# Agent Buddy: production plan and tracker

The plan for taking Agent Buddy from "works against a fake ServiceNow" to "approved and used daily by real agents", and the
status of every item. The plan was agreed on 2026-10-30; round 3 is built and was pushed to `main` on 2026-11-01 (see the
progress log). **Next session: start at "Where to pick up" just below.**

**Status:** `Planned` (in the plan, not yet agreed) · `Agreed` (you approved the plan for it) · `Building` · `Ready for review`
(built, tested and pushed; waiting for you to see it working, best on the real instance in V1) · `Partly built` (the row says
what is left) · `Done` (built, tested, shown to you, committed) · `Needs you` (only you can do it) · `Dropped`.

## Where to pick up (updated 2026-11-01)

Everything planned is built and on GitHub (`62b4d42` to the latest commit on `main`). Status: 78 ready for review, 1 partly built
(R6), 3 need you (V1 to V3), 2 agreed for later (R3, R5). Nothing has been seen on the real instance yet.

Why those labels: **R6 is partly built** because its accessibility and dark-mode check is done but its shortcuts and languages wait for
your decision. **R3 and R5 are "agreed for later"** because Claude left them out of round 3 to wait for your decisions; you did not
ask for that.

**Done since (2026-11-01, session after the wrap-up):**

- **R1 is finished.** The e2e job passes on GitHub's `ubuntu-latest` (run 41265048867: 1,010 pass, 0 fail). The cause: headless Chrome on
  Linux makes the popup that holds the panel the "last focused window" about 350 ms after it loads, and the panel reads the active tab
  of that window, so it read itself and never found the ServiceNow tab (scenario b, then every scenario after it). The harness now
  takes the main window's focus away and gives it back (the only way that worked there). Also: a failed scenario now prints the pages,
  windows, focus changes and errors; the workflow can be run by hand with a list of scenarios; the actions are on Node 24 (v7).
  Left: take `continue-on-error: true` off the e2e job once it has passed a few times.
- **R6, accessibility and dark mode: done and proven.** New e2e scenario `zz` (`e2e/a11y.js`) audits every screen and half, the
  cards opened, the first-run card, the preview dialog, an answer, the Team full page and Settings in light and dark: contrast, names,
  labels, tab structure, visible focus, 24 px targets, duplicate ids; then reduced motion and 320 px. Contrast was already fine. It
  found two real faults, both fixed: the selected Insights / AI Assist tab lost its keyboard focus ring, and a screen with one half
  was a tab panel named by a tab that does not exist.

**When you say "continue", Claude starts here:**

1. **Ask you the three decisions** that hold back R3, R5 and the rest of R6 (still open):
   - R3: Chrome Web Store, or self-hosted (your own update address, the extension pushed by Chrome policy)?
   - R5: OK to ship minified bundles (the content script is 380 KB on every ServiceNow page), with a readable copy kept for the
     security review?
   - R6: keyboard shortcuts yes or no (they need a manifest `commands` change, which the build rules forbid without your
     approval), and which languages, if any?
2. **Then R3, R5 and the rest of R6**, as you decided.
3. **V1, the real-instance walk-through, whenever you are at Chrome** (it can go first if you are). Reload Agent Buddy in the
   already-open Chrome from `D:\AgentBuddy\dist` (no separate automation window), sign in to dev364920 yourself, and walk a real
   ticket screen by screen. Answer the open questions in `docs/live-questions/`, these four first: the email form takes Insert or
   forces Copy (`compose.md` 3), Chrome accepts the `defaultDashboard` policy as one object (`policy.md` 15), priority-account names
   match the case (`policy.md` 16), the labels of a Workspace's notes boxes (`checks.md` 20).
4. **V2, AI answer quality.** Every AI function on real tickets with DeepSeek (you enter the key in Settings, never in chat).

How to check a change: `node tests/run.js` (unit, 2,729), `node scripts/check-compile.js`, `node build.js`, `node e2e/run.js`
(1,010 checks, needs puppeteer-core), `node scripts/traceability.js --check` (CI fails if the review map is stale; run it without
`--check` to rewrite the map). Rules for every change: `docs/build-rules.md`.

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

**Totals:** 83 rows. Built 60 · Partly 9 · New 14. Seen on the real instance: 1 fully, 4 partly, 57 not yet.

### 3.1 Foundation (every screen stands on it)

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| F1 | Setup and turn-on | Insights | All | Built | First-run card, "Turn on for this site", host permission | Offer "Turn on" only on ServiceNow pages ("turn on anyway" for custom domains); exact policy instances on automatically; a refused permission explains the next step; open tabs keep working after an extension update; one Getting started card; "Skip AI for now" | Seen | Ready for review |
| F2 | Settings | Insights | All | Built | Options page (one long page) | Split into Basics and AI Assist; plain words; instance shown in the panel header | Not yet | Ready for review |
| F3 | Record detection | Insights | All | Built | Content script: classic, Next Experience, Workspace, portal | HR child tables recognised as HR; `/task.do` resolves the real type; blank forms detected on every UI | Partly | Ready for review |
| F4 | Reading from ServiceNow | Insights | All | Built | GET-only Table/Aggregate reads with the agent's session | A time limit on every read with "Try again"; session token dropped after a 401 and "sign in again" shown; tables not on the instance hidden, not shown as raw errors | Partly | Ready for review |
| F5 | Insert into the form | Insights | All | Built | Fills one field on the open form; never saves | Edit before Insert; replace or append (no duplicates); the right field per type (problem `fix_notes`/`cause_notes`); pre-check that the field is there; say where text lands and the next step (Save, Post); verified on classic, Next Experience, Workspace composer, portals | Not yet | Ready for review |
| F6 | Quick-actions bar and the "AB" tab on the page | Both | All | Built | Panel bar above the record tabs; tab on the page edge | State-aware actions from both halves, each marked; none from AI Assist when AI is off; the page tab gets an icon and label, sits below ServiceNow's dialogs (today on top of them), is draggable and clear of the Workspace sidebar | Partly | Ready for review |
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
| N1 | Ticket at a glance | Insights | All | Partly | Record header: number, title, kind, state, priority | SLA time left, "customer waiting since", last update, owner, VIP and outage marks; refreshes after Save; holds the quick-actions bar. Done: the header is read again about 1.5 seconds after a Save on the same record (the classic or Next Experience form reloads; on a Workspace, its Save button or Ctrl+S) | Not yet | Ready for review |

### 3.4 Ticket screen: Insights

| # | Function | Half | Profiles | Before | Where it was before | What we will improve or build | Real check | Status |
|---|---|---|---|---|---|---|---|---|
| N2 | Related tickets (caller history, solved look-alikes, open duplicates) | Insights | All | Built | Related tab | Collapsed groups with counts; links open in the agent's own UI and never replace the ticket being worked on | Not yet | Ready for review |
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
| R3 | Deployment | - | - | Partly | `docs/deployment.md`, policy samples | Chrome/Edge policy install, update address, store or self-hosted | - | Agreed |
| R4 | e2e stability | - | - | New | Scenario b timed out once under load | Find out whether it is flaky and fix it | - | Ready for review |
| R5 | Performance | - | - | New | Unminified: 380 KB content script on every ServiceNow page, 1.35 MB panel | Smaller bundles, measured load time | - | Agreed |
| R6 | Accessibility, dark mode, shortcuts, languages | - | - | Partly | Dark-mode tokens and focus fixes exist; no keyboard shortcuts | Accessibility pass and dark-mode check, shortcuts, other languages. Done: accessibility and dark-mode audit in the real browser (e2e scenario `zz`, light and dark, every screen; two faults found and fixed). Left: shortcuts (manifest change) and other languages, they wait for your decision | - | Partly built |
| R7 | e2e harness: attach to a new tab before its first request | - | - | New | Record links from the Ticket screen open in a new tab; the harness can miss its first reads, so the coverage check tolerates up to 5 plain GET reads (listed) | Attach through the DevTools protocol before the tab starts (auto-attach, wait for debugger), then drop the tolerance. Done: new pages are logged from their start, and every http(s) request is logged in the browser (held and continued at once), so the reads a page makes as it closes or navigates are seen too; coverage has zero tolerance (0 missing in 4 of 4 full runs) | - | Ready for review |

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
