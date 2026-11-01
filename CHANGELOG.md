# Changelog

All notable changes to Agent Buddy. The version stays 0.1.0 until the first release is cut (the lead decides the number). Rows in
brackets are the `TRACKER.md` items.

## Unreleased: round 3 (one release with both halves)

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
