# Changelog

All notable changes to Agent Buddy. The version stays 0.1.0 until the first release is cut (the lead decides the number). Rows in
brackets are the `TRACKER.md` items.

## Unreleased: round 3 (one release with both halves)

### Screens at the bottom, every option in a side rail (the layout you approved as a mockup, 2026-11-05)
- You said the Ticket screen spent its first screen on the ticket, "Needs you now", one Summarise step and a big quick-actions block,
  with Insights and AI Assist only near the bottom. From a mockup (https://claude.ai/artifact/WMmZMaVbxigc1WP3UrUgj3) you chose: the
  screens stay at the bottom, and "the right side has all the options". Right-side panel only (no bottom docking). Built by three agents
  in parallel from one spec (`docs/rail-layout.md`).
- **The frame:** the screens (My work, Team, Ticket, Write, Knowledge) are a bar along the bottom, each icon with its name, no longer a
  floating pill over the list. Beside the screens, a slim **side rail** lists everything the screen on show offers for the half on show;
  names on hover and on the keyboard, "Show names" widens it; it stays put while the screen scrolls; mirrored (on the left) in Arabic.
- **Ticket:** the top is the compact ticket (number, priority, title, chips for the state, the SLA and "Unassigned"; the other facts
  behind "Ticket details"), then Insights | AI Assist straight away (the Insights tab says how many things need a look). The SLA, a
  customer waiting and a possible outage are the first rows of Insights. The one next step and the quick-actions bar are gone. The rail:
  with Insights on, "All insights" and every card (a dot where one needs a look; a click shows that card alone, with the way back); with
  AI Assist on, "Suggested" and every AI action for the ticket, what fits its state first (a click starts it, the check before sending
  first, exactly as in AI Assist).
- **My work, Team, Write, Knowledge:** their rail lists their sections (a click opens a folded one and brings it into view).
- **Settings > Side rail** (was Quick actions): per kind of record and per half, hide what you never use and put what you use most at
  the top; whether what fits the ticket's state comes first; and the AI actions (up to 4) of the small tab on the ServiceNow page,
  which used to be chosen in the panel.
- Unit 3,050; end-to-end 1,169 of 1,169 (scenario x now covers the Ticket rail, zw the bar and the rail), with the accessibility audit
  in light, dark, Arabic and at 320 px.

### A calmer, clearer panel (the redesign you approved as a mockup)
- You said the UI/UX and layout were not great. Claude photographed every screen at the panel's real width, wrote down what made it
  unattractive (a wall of boxes, the important facts hidden, two accent colours, technical text, thin screens), made a mockup, and you
  chose "calm and focused". Built by six agents in parallel from one written spec; the before, the mockup and the built screens sit side
  by side on the design canvas.
- **One look everywhere:** green is the only accent; AI is a small grey sparkle (no purple, no "+"); sections are separated by space
  and thin lines instead of boxes inside boxes; body text 14px; every arrow on something that opens points down. The header has three
  buttons (search, colours, Settings); the screens' dock is a white pill with the screen on show in green.
- **Ticket:** "Needs you now" at the top (the SLA, the customer waiting, an outage or a card that needs a look, in plain sentences, from
  what the panel already read), then ONE next step ("Draft a reply to the customer"), then the quick actions as small pills. Insights is
  one list: a dot, the card's name and its answer visible without opening, the cards that need a look first and the ones with nothing to
  report under "All clear in ...". A card that could not read its data no longer says "all clear", and a card you opened stays where it
  is. AI Assist: an ask box, the suggested actions as rows with Start, the answer as a quiet panel, more actions as pills; the endpoint
  line is gone from the top (the destination is named in the check before sending).
- **The check before sending** reads like the ticket: how many names, emails, phone numbers, cards and passwords are hidden, the
  ticket's fields, the description and the notes as text, every hidden value as a green chip; the exact text and the rules one click
  away; "Hide something else" instead of "Mask this too".
- **My work** without the red alarm frame, tickets as rows with status dots and two-line titles; **Team** shows each number once (Workload
  and the SLA radar no longer repeat Overview's tiles), calm tiles and bars, one "..." menu per section; **Write** as calm sections with
  snippets as rows and a real empty state; **Knowledge** starts with the articles for the open ticket; **Settings** has a menu of its
  sections, switches, and quiet red buttons for what removes data.
- Unit 3,007; the full end-to-end run 1,169 of 1,169, with the accessibility audit of every screen in light, dark and Arabic (it now
  also accepts a focus ring drawn on a field's own box).

### The page dock without the corner mark
- You asked why the icons of the bar on the ServiceNow page carried a "+". It was the AI spark in the corner of each AI action, too small
  to read as anything but a plus. It is gone; an AI action still says so in its name on hover (the AI badge) and to a screen reader.
  Every action icon now looks the same (you chose that): the first one is no longer filled green; the step suggested for the
  ticket's state is still first, and only the Agent Buddy mark is filled. Scenario `y` checks both.

### Easier to work on (audit phase 5)
- **Unreachable code removed** (3,645 lines): panel views no screen shows, a READ nobody sends, dollar caps nothing could set,
  provider code `sendChat` never used, unused exports, 133 Arabic entries for texts only that code used.
- **Settings in folders.** `src/options/Options.jsx` (about 1,500 lines, 17 components) is a 187-line root with `fields.jsx` (the shared
  pieces and one `useSaveSetting` hook instead of six copies of the save handler), `provider/`, `basics/` and `data/`. The activity
  log's CSV goes through the shared download (UTF-8 for Excel); a stored follow-up period of 5.5 days is read as 5, not reset to 3.
- **One copy of each helper**: the Luhn check (`src/pii/luhn.js`), the spreadsheet-formula guard for exports (`src/lib/export.js`), the
  sys_id, table and field patterns and `sameId` (`src/context/util.js`; a table name over 80 characters is refused everywhere), the
  group search (`useGroupSearch`), the copy helper, the preview style (`previewCheck`), the Insert findings box (`InsertFindings`) and the
  answer cards' Insert actions (`useInsertActions`). Functions that shared a name but not a meaning were renamed (`daysSinceSnTime` and
  `wholeDaysSince`, `glanceSlaLine` and `mostPressingSla`, `cardIdsFor`).
- **Docs**: `docs/review/audit-2026-11-04.md` (what was found, the commits, what is still yours to decide), build rule 2 says what a view
  may import (and lint checks it), the one exception to "Insert fills one field" is named, the README lists the new scripts.

### Lint, and the end-to-end run made dependable (audit phase 4, second half)
- **ESLint** (`npm run lint`, part of `npm run verify` and CI): the recommended rules, the two rules of React hooks, unused names
  everywhere, and in `src` `no-shadow` and `no-await-in-loop`. Views may not import the AI senders or the seal (build rule 2, now
  checked as you type). 302 findings fixed: about 110 `React` imports the build no longer needs, 60 inner names that hid an outer one
  (mostly a loop variable `t` hiding the text function `t()`, the mistake that crashed the custom report editor), about 50 values
  written and never read, and the reasons written next to the 12 places where a rule is set aside on purpose (retries one after
  another, regular expressions whose point is control characters).
- **Found on the way:** two checks in scenario `o` held a literal backspace character where a word boundary was meant, so "Erin never
  reached the AI" could not fail on the name; two tests of the page bar that an earlier change had dropped are back.
- **A dependable end-to-end run.** The "every read was seen by the browser log" check failed now and then. The harness took a report
  with a request id and address it had already seen for a second report of the same request; Chrome starts request ids again in a new
  renderer process, so later reads of the most-read record were dropped from the log. A report from the same source is now a new
  request (and counted in the run's notes). The fake ServiceNow also no longer closes idle connections, so a read cannot be silently sent
  twice; the check says how many reads went unanswered. Scenario `x` sets everything it relies on, and the steps that failed on a
  runner now say what the panel showed.

### Audit fixes, phase 3: names, dates and numbers that are right
- **Names in every script.** Matching a note's author to the customer kept only the letters a to z, so an Arabic, Cyrillic or Chinese
  name became nothing: "Ready to resolve?" said the customer was not waiting when they were, the mood signals and the journey did not
  see the customer, and distinct fixes written in Arabic were dropped as duplicates. One shared module (`src/context/identity.js`) now
  does this for every check, keeps letters of every script, and knows HR cases' customers (opened for, subject person). An unknown name
  is "cannot tell", never a match.
- **Who wrote last, when.** Comments and work notes read from two places with two clocks are no longer sorted together as if they were
  one; a note in summer time on a record updated in winter is no longer an hour off while called exact; a colleague's reply to the
  customer counts as an update in My work; the ticket journey keeps the newest 60 changes, not the oldest; a stale hold reason no longer
  makes the email suggestions think the ticket is on hold.
- **Text as written.** "List<String>" and "a<b and c>d" in a plain field or a note are no longer cut out as if they were HTML; HTML is
  stripped only where there is HTML, and stripping is fast on any text (hostile markup took seconds to minutes before).
- **Snippets and formats.** "Hello {{caller.first_name}}" uses the first name from the person's record ("Mary Ann", not "Mary"); a
  backup the snippets page writes can always be read back; the next SLA due and knowledge lists sort by time, not by how the date is
  written; a problem offers its fix notes. "Use the standard format" now holds over an organisation's format that is not locked (it said
  so, but the organisation's format stayed), and Settings and the panel both offer the organisation's format back.
- **Reports.** The Workload widget no longer breaks for a team of more than 12 people; the SLA radar counts and lists only tickets that are
  breached, at risk or due soon; Quality's backlog and every person's "Open" agree with the Open tile; "(unassigned)" opens its list;
  custom reports with an average draw no donut and no percentages and say so when nothing matches; a week-grouped report draws only the
  weeks its filter covers and does not call a capped count the total; "last 14 days" is 14 at any hour; days in zones whose clocks
  change at midnight are right; "opened today" means today. The custom report editor no longer fails as it opens (scenario `s` now opens
  it), and its Preview works for HR reports.
- **Smaller.** The request status line no longer says "SLA: finished" when every SLA was cancelled; plural names from the instance get no
  English "s" in Arabic; `http://[::1]` is refused with a clear message (only localhost and 127.0.0.1 can be reached); the "too long"
  messages name the model's real budget and no longer promise a server setting that changes nothing.

### Audit fixes, phase 2: the right ticket, fresh data, no races
- **The Ticket screen keeps to the ticket on screen.** A late header read for the previous ticket no longer replaces the new one's
  (number, title, state); an action is checked against the right ticket's header; the Insights summaries and warning dots are no longer
  wiped when cards draw from data already read. "Ready to resolve?" in the quick bar and the palette now opens its card (it pointed at a
  card that did not exist, so it never showed).
- **The command palette** offers no "This ticket" actions while the Ticket screen is hidden (setup help shown), does not open over the
  check before sending, and an action chosen in it expires after 30 seconds like one from the page.
- **Other screens.** My work no longer shows the previous site's queue (whose rows opened another site's records) after switching tabs;
  the Knowledge tools start over on another site; "Check my comment" no longer shows one field's findings under another; Rewrite reads
  the form only when it is the ticket open in the panel, and text read from a form stays bound to it through edits (only text typed or
  pasted over all of it becomes your own); the coaching "rates people" hold applies to every new answer, not only the first; a coaching
  sample for one group can no longer land after you picked another; a report that fails after a change of scope no longer shows the old
  scope's numbers; a dashboard save warning clears after a later save works; the follow-up period chosen in My work is the setting.
- **Settings.** The line under the key box follows the key when it is moved or encrypted; the profile boxes show what was saved (and
  refuse an empty choice); a failed save says so once; "Clear everything" turns off every site, also one the organisation's list leaves
  out, and its outcome stays on screen; Settings and the panel re-read only for changes that matter (not on every usage-log write), and
  an older read can no longer overwrite a newer one. "Clear everything" also forgets drafts carried to another form, and cards drop
  what they showed.
- **On the ServiceNow page.** After an extension update, an open page gets the new page bridge without a reload (a newer bridge takes
  over from the old one, and only one answers); forms opened through `task.do` are matched to their record (Check, Rewrite and Insert
  work there); a record found by its number is checked to be that number; a failed class lookup is not repeated every 2 seconds; reports
  find who is signed in the same checked way as everything else.

### Audit fixes, phase 1: privacy, the organisation's policy and the AI firewall
- A full read-only audit (seven reviews, about 110 findings) came first; this is the first of five phases of fixes.
- **What reaches the AI.** Invisible characters (direction marks common in Arabic text pasted from Outlook, invisible operators,
  variation selectors, the tag block...) no longer hide an email or a number from masking; one list (`src/lib/invisible.js`) serves the
  firewall and the answer renderer. A password, card, IBAN, ID or phone number seen once is masked again even when written against
  other text ("ID4471234"); the final check follows the same rule, so ordinary text ("Welcome1 ... Welcome12") no longer stops a run
  with nothing the person could do. A name inside an address no longer leaves the rest of the address readable. Arabic labels followed
  by long runs of spaces no longer slow masking down (seconds before, milliseconds now). "Mask this too" masks whole words only, never
  the fixed instructions, and says so when the selection is only part of longer words.
- **Everyone named is masked.** Approvers, task owners and people on linked records past the 30th were dropped from the list the
  firewall masks while their rows were still sent; now every person a sent row names is on it.
- **The organisation's policy wins everywhere.** "Local only" now also stops Test connection and Load models from contacting a cloud
  AI; AI switched off by the policy is refused by the run itself, not only hidden; a model the policy allows is used even when it is not
  on the provider's built-in list (it was replaced, then refused, so AI never worked); a bad AI address in the policy says to ask the
  administrator. A dot-walked column through a blocked table (`request.requested_for` with `sc_request` blocked) is refused, in reports
  too; HR cases no longer appear in similar-ticket searches on `task`; an HR case's title is read only where HR content is allowed;
  blocked columns in the request status line and in "Explain this dashboard" stay out.
- **The check before sending** is a new one for every run: a full check can no longer show as the short one after switching tickets,
  and text typed on one ticket's check no longer appears on another's. "Clear everything" and turning a site off also forget the
  answers, card reads and inserts held in the panel's memory. AI answers that were billed and then rejected now count toward the daily
  limits; days with more than 500 calls are counted in full.

### Build, tests and CI (audit phase 4, first half)
- `npm run verify` runs every gate CI runs (unit tests, compile check, review map, Arabic); `npm run i18n` and
  `npm run traceability:check` exist on their own. `npm ci` installs everything the end-to-end run needs (puppeteer-core is pinned).
- A test filter or end-to-end scenario id that matches nothing now fails instead of reporting success; the read-only guard test that
  scanned nothing on Windows scans the content script again; timing tests measure CPU time, so a busy computer no longer fails them.
- `.gitattributes` keeps every checkout LF, so a Windows checkout builds the same bytes; CI also runs the unit tests on Windows and the
  end-to-end run on the minified build that is shipped (`npm run package -- --minify` builds into `release/unpacked/`, not `dist/`).
- The release carries the licence files of the bundled React packages (`licenses/`). Node 22.12 or later (`.nvmrc`, `engines`).

### Answer formats: write the summary the way you want it (R11)
- You asked whether the summary (and the other AI actions) can follow a format of your own, for example "Issue, Key actions performed" and
  so on, instead of the fixed one. **Settings > AI Assist > "How AI answers are written"** now lists every action whose format can change,
  and the same editor opens under the action in the side panel ("Change format").
- **The ticket summary, the hand-off brief and the discussion catch-up** take a list of sections you name, order, add and remove (each with
  a few words on what belongs in it), a style (a line or two, or bullet points) and a length (30 to 500 words). Start from a ready layout
  ("Issue, key actions, outcome", "Situation, background, assessment, recommendation"...) or from the standard one.
- **Every one of those 20 actions** also takes a few lines of extra instructions (tone, length, wording). An action whose answer the panel
  reads back (resolution notes, the hand-over note...) or that the customer reads takes the extra instructions only, so Insert and the
  hand-over view keep finding their labels and the customer rules stay on.
- **Nothing replaces a whole prompt.** The facts-only, customer-safe and language rules are built in after your sections; your extra
  instructions come after all the rules and say they never remove one; the firewall's rule that ticket data is never an instruction is
  still in every request. "Show the instructions this sends" shows the text, and the check before sending shows it as always.
- **Team formats:** an organisation can publish a format for everyone, or lock one, through the policy (`orgFormats`, in
  `managed_schema.json`, `docs/deployment.md` and `scripts/check-policy.js`). A lead builds it in Settings and presses "Copy for your
  administrator" to get the entry to paste. Locked: people can read it and not change it; not locked: it is the standard until a person saves
  their own.
- English and Arabic (right to left, checked at 320 px); scenario `zv` (Settings, the panel, the AI request), `zy` and `zz` with the
  editor open, `tests/formats.test.js` (the default builds the fixed prompt word for word), `tests/formats-editor.test.js`.

### The page dock has no fold button (R10)
- You said the fold button is not needed. The chevron at the end of the dock is gone; a click on the Agent Buddy mark closes the dock down to
  the mark (a small pill) and opens it again, and Escape closes it from the keyboard. The mark's name says "Click to close" while open and
  "Click to open" when closed (English and Arabic). The dock is 32 px narrower.

### Fix: pressing an icon of the page dock after hovering it (R10)
- Seen on dev364920: hover an icon until its name shows, press it, and the dock said "Nothing was started: something on the page was
  covering the bar". The name's soft drop shadow reached down over the icons, and Chrome's visibility check (the guard against a page
  drawing over the dock, `clickVerdict`) counts a shadow as covering. The name and the note above the dock now have a small shadow that
  stays clear of the icons, the gap above the dock is 12 px, and the icons' keyboard focus ring fits inside the 4 px gap between icons
  (a focused icon must not "cover" its neighbour either). The guard itself is unchanged.
- A dialog that is in the page but not shown (a classic form keeps a hidden light box with `aria-modal="true"` in the page) no longer
  hides the dock; only a dialog that is on screen does.
- Scenario `z` now hovers the icon for a moment before pressing it (the earlier run pressed it before Chrome had looked again, which is
  why it passed); scenario `y` checks the hidden-dialog case; `tests/bar-logic.test.js` reads the stylesheet and fails if a shadow or ring
  would reach an icon again.

### The panel's screens as an icon dock at the bottom (R10, phase 2)
- The row of text tabs under the header (Ticket, My work, Team, Write, Knowledge) is now a **floating icon dock at the bottom centre of the
  panel**, the same pill as the one on the ServiceNow page: a ticket, an inbox, two people, a pen and a book. The screen on show is filled
  green. It floats above the screen while it scrolls and sits after the last card at the end.
- **Hover or tab to an icon and its name shows above it.** The name is also the icon's text for a screen reader, so the tab list is as it was
  (one tab stop, left and right arrows, Home and End); it comes after the screens in the page, as it does on the screen, and is inert behind
  the command palette and the dialogs like the rest of the panel. In Arabic it is mirrored and the names are Arabic.
- Scenario `zw` (the dock), `tests/icon-dock.test.js` (every screen and every action has an icon that can be drawn); questions for you in
  `docs/live-questions/look.md` (8 to 10).

### The icon dock on the ServiceNow page (R10, phase 1)
- The small tab on the right edge of the page, and the 236 px card of text buttons it opened, are replaced by a **dock at the bottom
  centre** of the window: a white pill with the Buddy mark and one round icon button per main action (the same icons as the panel's
  quick actions; the main one filled green; AI actions carry a small spark in the corner, Insights ones do not).
- **Hover or tab to an icon and its name shows at once** above the dock, with the AI mark and one line saying where text goes ("Uses AI:
  opens the side panel, which shows what will be sent first" or "Stays in ServiceNow"). Escape takes the name away, then folds the dock.
  Light, dark and Arabic (right to left) all follow the setting.
- A click on the mark closes the dock down to a small pill and opens it again (there is no separate fold button); drag the mark, or press
  the left and right arrows on it, to move the dock along the bottom. The middle of the dock stays where it was put when it opens and folds, and it is kept
  inside the window. The old "Move to the left / right" button is gone; the place is remembered in the page as before.
- Nothing about what the dock may do changed: a closed shadow root, only real clicks, the visibility check, a layer below the page's
  dialogs, hidden while a dialog is open, nothing loaded (the icons are drawn with DOM calls), no ticket text.
- The icon drawing data moved to `src/sidepanel/ui/iconPaths.js` so the page script and the panel use one set. Scenarios `y`, `z`, `zy`
  and `tests/bar-logic.test.js` follow the new dock; questions for you in `docs/live-questions/quickbar.md` (19 to 22).

### Look and feel, colours and the command palette (R9)
- A real header: the product mark, the name, the instance the panel reads (with a green dot), and four buttons: search commands, the
  sun or moon, the privacy shield, Settings. One small icon set (`src/sidepanel/ui/icons.jsx`) for the whole panel.
- The ticket at a glance: the number and the VIP marks on one line, the title under them (two lines instead of cut off), the state,
  priority and SLA as chips (amber and red when they need a look). The quick actions are tiles with an icon, the name and the AI mark.
- Settings > Basics > Appearance: Same as the computer, Light or Dark. It applies to the panel, Settings, the Team page and the bar on
  the ServiceNow page (the worker tells the bar, as it does the language). The sun or moon button in the header switches it in one click.
- The command palette: `Ctrl+K` (Mac `Cmd+K`) or the header button. Type "reply", "team", "dark", "arabic" and press Enter. It lists the
  screens, every AI action the open ticket offers, the Insights cards of the quick bar, Show Insights / Show AI Assist, Settings, the
  colours and the languages, in English or Arabic (English words still find the Arabic commands). An AI action chosen here opens the
  same preview as its button: nothing is sent by the palette. The panel behind it is inert while it is open.
- The half a screen shows (Insights or AI Assist) now follows a change made elsewhere, so a command can switch it.

### Setup and turn-on (F1)
- "Turn on for this site" is offered only on a ServiceNow page: a ServiceNow address, or a page that shows ServiceNow's marks (one
  look through the toolbar click's `activeTab`, no new permission). Elsewhere the panel says "This does not look like ServiceNow"
  and keeps a small "Turn on anyway" for an instance on its own domain.
- Exact instance addresses in the organisation's `allowedInstances` (managed policy or enterprise build) are turned on by
  themselves once the browser has granted the site; Settings lists them as "Turned on by your organisation".
- A refused site permission says the next step (press again and choose Allow; if no question appears, IT may block it).
- After an extension update the open ServiceNow tabs keep working: the service worker injects the new content script, which
  replaces the old copy; the old copy's bar removes itself.
- One "Getting started" card instead of three: turn on, what you work on, set up AI or "Skip AI for now", open a ticket.

### Work profiles (F9)
- First run asks "What do you work on?", pre-filled from the person's ServiceNow roles, the groups they manage and the catalog
  work assigned to them; Settings has the same choice, "Show everything" and "Skip AI". Policy can limit and lock profiles; HR
  only where the organisation approved HR work.

### Settings (F2, F8)
- Settings is two pages: Basics (sites, what you work on, quick actions, privacy in plain words, activity log, stored data,
  clear data) and AI Assist (provider, address, model, key, test, limits). Technical details are folded. With AI switched off by
  the organisation the AI page says so and shows nothing else.
- "Copy diagnostics": versions, settings without any key, the policy in short, the sites (hosts), the last problems of the
  activity log. No key, no key preview, no ticket content.

### Record detection and reading (F3, F4)
- HR child tables (`sn_hr_core_case_payroll`, `sn_hr_le_case`, ... every `sn_hr_*case*`) are HR cases, so the employee on the case
  is read as a person and masked.
- A record opened as `/task.do` or `/record/task/<id>` shows its real type.
- Blank forms (`sys_id=-1`) are recognised as new records from the address too (Next Experience, Workspace).
- Every read from ServiceNow has a time limit (20 seconds) with a plain reason and "Try again".
- After a 401 the session token is read again from the page; the message says to sign in again.
- A table that is not on the instance (a plugin not installed) is left out quietly instead of shown as an error.

### The screens (2.1, 2.2)
- Five screens: Ticket, My work, Team, Write, Knowledge (which ones show comes from the work profiles and policy). Every screen is
  split into Insights (reads with the person's session, sends nothing anywhere) and AI Assist (every button carries the AI mark and
  the half says where masked text goes).
- Clutter budget on every screen: one filled button, three items then "Show more", one-line summaries on folded cards.

### Ticket screen (N1 to N29, AI0.2 to AI22)
- Ticket at a glance: SLA time left, customer waiting since, last update, owner, VIP and outage marks, the quick-actions bar.
- Insights: 17 cards (related tickets, knowledge, ready to resolve, request status, checklist, article checks, chat facts, risk
  signals, where similar tickets went, missing details, steps that worked before, which email fits, ticket journey, recent changes,
  known errors, account at a glance, outage spotter), each folded with a one-line summary.
- AI Assist: the actions grouped (Understand, Reply, Work it, Resolve), three that fit the ticket's state first and the rest under
  "More actions"; several answers kept per ticket with Refine, Edit before Insert, Replace or Append; "Ask about this ticket".
- What is sent is smaller: one block for short fields, email history and signatures left out, fitted to the model's context, and
  the model is told what it did not get. HR records need Strict privacy mode for every AI function.

### My work, Team, Write, Knowledge (N13 to N27, AI23 to AI30)
- My work counts every open ticket (no 25-per-table cut-off), with "customer replied" markers, SLA time left, follow-ups due and
  the groups' unassigned queue.
- Team: three controls before the first number; dashboards per instance with layout export and import; the hand-over tables.
- Write: organisation snippets from policy and "Check my comment" (including the organisation's internal phrases).
- Knowledge: a search box for any article, with the duplicate finder and the gap radar.

### Finished on 2026-10-31 (N1, N4, N17, N28, AI0.1, AI9, R7)
- The ticket header is read again about 1.5 seconds after a Save on the same record (the form reloads; on a Workspace, its Save
  button or Ctrl+S).
- "Ready to resolve?" counts the notes typed and not saved on a Workspace page too (read only; close code and state stay the saved
  ones there).
- Policy `defaultDashboard`: a saved dashboard layout becomes the first dashboard of anyone without one; others get "Add your
  organisation's dashboard". A dashboard over every table is now saved without `"tables"` (no null), so the file works as policy.
- Policy `priorityAccounts`: the organisation's priority accounts by name; a "Priority account" tag on the Account card and in
  the ticket header.
- A locked AI key is unlocked right in the panel (AI Assist, Getting started), with the same unlock as Settings.
- AI email drafts: "Open the email form" carries the draft to that ticket's email form (a new tab), where "Insert subject" and
  "Insert body" fill it. The subject keeps the ticket number. Nothing is sent until Send.
- End-to-end harness: every request is logged from the start to the end of each page, and the read-only coverage check has no
  allowance any more.

### The tab on the ServiceNow page (F6)
- An icon and a short label instead of the letters "AB"; it can be dragged up or down (arrow keys too) and remembers its place.
- It sits below ServiceNow's dialogs and hides while one is open; on a Workspace it starts lower, clear of the Workspace's icons.
- Without AI (switched off, skipped, no key) it offers the no-AI items ("Ready to resolve?", "Related tickets"); AI actions carry
  the AI mark.

### Removed (F7)
- `src/sidepanel/tabs/Stub.jsx` (unused).

### Release and quality (R1, R2, R4)
- CI on every push: unit tests, compile check, build, traceability check, `npm audit --omit=dev`; an end-to-end job on Ubuntu
  with Chrome (allowed to fail until it has proven itself on a hosted runner).
- `scripts/package.js`: a reproducible `release/agentbuddy-<version>.zip` with its SHA-256 next to it.
- End-to-end scenario b no longer depends on how fast a loaded machine injects into an already open tab.
