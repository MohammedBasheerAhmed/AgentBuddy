# Round 5: calm first screens, reports, control before AI (2026-11-22)

**Why.** Leaders said, again, that Agent Buddy is heavy and has no story. The user's order: improve the product first; the story and the
pitch deck come last. A 400 px screenshot check (2026-11-22) showed the Ticket screen is already calm (16 to 18 controls, one screenful)
and the heavy screens are **My work** (35 controls, about 2 screens) and **Team** (55 controls, about 4 screens). The page script that
loads on every page of an added site had grown to 512 KB minified.

**Mockups (approved: "go ahead", 2026-11-22):** canvas https://claude.ai/artifact/3WbAzpN8BU5yganDfc4LQm; the same boards as files in
`docs/round5-boards/*.dc.html` (read them for exact copy, order and layout). All numbers on them are SAMPLE numbers: the built screens
show real ones, or say plainly that a number could not be read.

| Board | File | What |
|---|---|---|
| A | `Main.dc.html` | My work, first screen: five rows |
| B | `MyWeek.dc.html` | My week |
| C | `Team.dc.html` | Team, first screen: five rows and a Weekly report button |
| D | `WeeklyReport.dc.html` | The weekly report in the panel |
| E | `WeeklyReportPdf.dc.html` | The same report as a PDF (A4) |
| F | `BeforeYouSend.dc.html` | The "Before you send" sheet (lead builds this one) |

**Decisions (user, 2026-11-22):** the header "All tools" button stays (no third "More" tab); reports are "My week" on My work and one
click "Weekly report" on Team; story and deck last. Open: whether per-person rows on Team are for managers only (names show only inside
an opened row, as on board C).

**The rules that apply to every row and screen** (docs/build-rules.md, `docs/focus-layout.md`, TRACKER 2.4 clutter budget, the product
filter): five rows, one finding on each row, detail one tap down, nothing new that needs another button row; plain words
(`docs/plain-words.md`); no emoji; only `--ab-*` colour tokens; works at 320 px and in dark mode and in Arabic (RTL); reads are GET only
and honest (a read that was refused or limited says so; never present "could not read" as "none").

## Phases and owners

1. **Page script size** (lead, done first): the reading engine is its own file, `reads.bundle.js`, injected by the panel the first time
   a read needs it (`src/content/readsEntry.js`, `src/sidepanel/ask.js`). The page script drops from 512 KB to the figure in TRACKER.
2. **A. First screens** (agent A): My work and Team Insights as five rows (boards A and C); the "My week" row and the "Weekly report"
   button open the views of phase 4 (`src/sidepanel/mywork/MyWeek.jsx`, `src/sidepanel/team/WeeklyReport.jsx`, props `{ onBack }`).
3. **B. Before you send** (lead, after A and C): board F; settings per AI action.
4. **C. Reports** (agent C): "My week" and "Weekly report" (boards B, D, E): the numbers, the AI paragraph, PDF / CSV / copy.

## Rules for the reports (agent C) and their AI paragraph

- The AI paragraph is written from **counts and ticket numbers only: no names, no ticket text** (a proposal the user has not
  contradicted; keep it that way and say so on screen: "Written from counts and ticket numbers. No names, no ticket text."). It goes
  through the firewall like every AI action (`useRun`; a feature definition; `parts`), never a direct call.
- PDF without a new library, permission or network destination: a print-styled view of the report that the browser saves as PDF
  (`window.print()` of an extension page), or whatever the existing export code (`src/sidepanel/reports/download.js`) already does.
- A measure the data cannot give honestly is left out of the view and listed in `docs/live-questions/weekly.md`, never made up.

## Status (2026-11-22)

All four phases are built and gated (R25 to R28 in TRACKER.md); not committed. Open decisions: the Team row "closed with a fix note"
(needs the quality engine to read `close_notes` as "is empty", question 7 in `docs/live-questions/rows.md`); approvals waiting on you and
unassigned tickets of my groups left My work's first screen (they are in "All N open tickets"); per-person rows on Team. Not built from
board F: tone, length and language as segmented choices (the format editor has them) and a Settings page for the defaults of "What goes in".
