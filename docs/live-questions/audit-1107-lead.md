# Live questions: the team lead's screen, "Needs attention now", less by default and numbers a lead can trust (wave 6, 2026-11-07)

Workstream "team lead". Built without a real instance. Each question below is something the build ASSUMES; the safe reading was built
(a count that could not be read is said, never shown as 0; a short list is "at least", never the whole). Check each with a REAL team
lead on a REAL instance, signed in as that lead (an `itil` user who belongs to a group with a queue), in the Team screen. The code is
`src/reports/engine/attention.js` (the section), `src/sidepanel/reports/folds.js` (what is open) and the two lines of constants noted
in questions 2 and 9.

## What the lead sees and means

1. **Does a lead find "what needs me now" at the top, and is the order right?** Assumed: breached, closest to breaking, approval
   waiting, reassigned often, open longest, customer waiting (strongest first), at most eight tickets, one row per ticket. Ask three
   leads to read the section for ten seconds and say which ticket they would open first, then compare with the first row.
   Change if wrong: the order is `ATTENTION_REASONS` in `attention.js`; the number of rows is `ATTENTION_MAX`.
2. **Are "3 days" and "15 days" the right lines?** Assumed: an approval or a customer that has waited 3 days or more is a reason (the
   same 3 days as "No update in 3+ days", `WAIT_MIN_DAYS`), and "open longest" starts where the ageing's last bucket starts, 15 days
   (`OLDEST_MIN_DAYS`). A younger wait is not yet a reason, so a calm queue says "Nothing needs attention". Ask what a lead would chase
   and when (an incident team: hours? a catalog team: days?). Change if wrong: those two constants; no other file.
3. **"Approval waiting" is how long the TICKET has been open, not how long the approval has been asked for.** The brief wanted
   "Approval waiting {n} days". The approval's own age is not in anything the Team screen reads (the approval table is read for
   counts only), so the row says "Approval waiting" and, under it, how old the ticket is. Ask a lead whether the ticket's age is good
   enough or whether the approval's own age matters (a change opened last week, approval asked yesterday). Change if it matters: read
   the approval's creation time for the few tickets listed (a new column on the approval spec, `docs/security.md`: a decision, not done).
4. **Which tickets count as "waiting for an approval"?** Assumed: the state says it: a change in Authorize, or a state whose words say
   approval (`waitsOn`, `docs/states.md`). A requested item waiting for approval shows state Pending and stage `waiting_for_approval`
   (verified live 2026-11-07); the stage is NOT read for these lists, so such an item counts as "on hold or pending", not as an
   approval, and appears in the "Approvals waiting" numbers but not as a row here. Ask a catalog lead how they find those items today.
   Change if it matters: add the stage to the hand-over's lists (a column on the spec; `stage` is the item's own column).
5. **"Customer waiting" is only seen where the state says it.** Assumed: a case or HR case in state 18 (Awaiting Info), a state whose
   label has caller / customer / user / requester / employee / reply / feedback, or a custom state like that. An incident On Hold with
   the hold reason "Awaiting Caller" is NOT seen (the hold reason is not read), so it shows as "other". Ask incident leads how they mark
   a ticket that waits for the caller: the hold reason, or a state of their own. Change if the hold reason is the way: read it for the
   waiting lists (the state label and the reason are both inputs of `waitsOn`; the column needs a place on the spec).
6. **Is the section quick enough on a big queue?** It asks the instance for nothing the Team overview does not ask, except that a ticket
   type with several kinds of wait gets one or two more short lists (the oldest approvals, the oldest customers, five rows each, the same
   columns as the hand-over's "Waiting the longest"). Time the Team screen's first load before and after on a queue of several thousand
   open tickets, with the Network tab filtered to the instance. Change if too slow: drop the per-kind lists (`readWaitingAndOldest`,
   `perKind: false`); approvals and customers then come only from the oldest five waiting tickets of each type.
7. **How big do the SLA reads get?** The radar reads at most 1,000 worrying SLAs (`LIMITS.slaRowsMax`) and looks up the first 200
   tickets. Past that the Breached, At risk and Due soon numbers are "at least" (a `+` after the number, and a line in the notes) and
   "Needs attention" says "some data could not be read". Ask the biggest team you can find for its number of breached SLAs. Change if
   common: raise the cap, or count breached tickets with an aggregate (a new kind of read).

## Honest when it cannot see

8. **An instance with no SLAs at all.** Assumed: an SLA table that returns no row cannot be told from one that hides every row, so the
   breached and closest-to-breaking counts are "not read" (rule 9) and Needs attention never says "Nothing needs attention" there; it
   says "Based on what you can see; some data could not be read". On an instance that does not use SLAs this line would always show.
   Check on an instance without SLA definitions. Change if it shows for good: treat an unreadable SLA table as "SLAs not in use" when the
   lead can read the SLA definitions (one more read), or leave the line as the price of honesty.
9. **A person this user may not see.** Assumed (as `docs/live-checks-2026-11-07.md` "Not settled"): a reference the user cannot read has
   an empty display value and a stored value; the row then says "Not shown to you", never "Unassigned". Check with a lead who is not in
   the group of a ticket assigned to someone from another group.
10. **Row-filtered reads.** A lead who can read only some tickets gets `200` with fewer rows and a total for all of them
   (`docs/live-checks-2026-11-07.md`). Assumed: the counts come from the same filtered reads as the lists, so a count may be too large
   when a condition is on a column the user cannot read; the section does not know. Check once with a lead whose role hides a column used
   in a filter (`reassignment_count`, `sys_updated_on`): compare the Reassigned count with the list the platform shows for the same
   filter. Change if they differ: say "at least" for that count, as for the SLA cap.

## The numbers match the platform

11. **Every number against the platform's own list.** For one lead and one group, open each number's list from the Team screen (click the
   tile, or the bar) and compare the count in the list header with the number on screen: Open, Unassigned, No update in 3+ days,
   Waiting, Breached, Due soon, Reassigned 3+ times, the last ageing cell (15+ days), Waiting for your approval, Approvals holding up the
   team. They should be equal, apart from the three known units (Breached and Due soon count tickets, their list shows SLAs; Approvals
   holding up the team counts approvals, not items; "Open" leaves out Resolved tickets that are still active, so the platform's
   `active=true` list is larger by exactly the Resolved, not closed tile). Write down every difference.
   Change if wrong: the engine's filter for that number (`src/reports/engine/overview.js`, `workload.js`).
12. **A ticket that is both at risk and due soon.** Assumed: it is one ticket in "Closest to breaking" and in the tickets at issue
   (`atRisk + dueSoon` can count it twice, so Needs attention uses tickets at issue less breached). Find a ticket with two SLAs (a
   response and a resolution) and compare with the radar. Change if wrong: `groupSlaByTicket` in `sla.js`.
13. **The meaning of a state is the one in `docs/states.md`.** Resolved-but-active tickets are left out of Open, Unassigned, No update,
   the ageing, the hand-offs and now the fulfilment's open items and oldest items, the same everywhere. Check on a queue with Resolved
   incidents and with a customer's own states (`docs/live-questions/audit-1107-states.md` has the questions per table).

## Less by default

14. **Is the open set right?** Open: Needs attention, Overview, Closest to breaking, Open work by person and group, Approvals waiting,
   Shift handover. Folded: Overview by ticket type, who holds the SLA risk, ageing, tickets reassigned 3+ times, Quality, the fulfilment
   states, other kinds of ticket, oldest open items, waiting by state. Show the Team screen to three leads and ask what they opened
   first, what they never opened, and what they looked for and could not find. A lead with one group sees "Open work by group" as a
   single bar: is that noise? Change if wrong: one word per part in `src/sidepanel/reports/folds.js` (`'open'` or `'fold'`).
15. **A Team overview saved before.** Needs attention now is added once at the top; a person who removes it is not given it again.
   Check on the dev instance with a dashboard saved by the build before this one: it appears first; remove it in Customize; reload the
   panel; it stays gone. The one thing stored is a list of section ids (`offered`), no numbers, no names.
16. **A new tab, next to the ServiceNow tab.** Assumed: a click on a ticket of the section opens it in a new tab right after the tab
   the panel is attached to (the same as every "look at this" link), as a Workspace record or a portal ticket page where the tab is one,
   in Chrome, Edge and Firefox. Check once in each browser, and that Ctrl+click and middle-click use the browser's own new tab.

## Not decided here

- **Who sees per-person rows** (the Open work by person bars) is the owner's open decision (audit of 2026-11-07, W-14). Nothing changed:
  today every member of a group sees every member's rows. If the answer is "the group's manager only", the one place is
  `foldByOwner` in `src/reports/engine/workload.js` (and `assigneeRows` in `workloadSection`): the rows are built there and nowhere else.
