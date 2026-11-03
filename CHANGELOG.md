# Changelog

All notable changes to Agent Buddy. The version stays 0.1.0 until the first release is cut (the lead decides the number). Rows in
brackets are the `TRACKER.md` items.

## Unreleased: round 3 (one release with both halves)

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
