# Live questions: My week and the weekly report (round 5, docs/round5.md, boards B, D and E)

Nothing here has run against a real instance: the unit tests drive the reads with a scriptable fake (`tests/round5-weekly-read.test.js`,
`tests/reports-fixtures.js`), and the screens were looked at with canned answers and against the end-to-end fake instance. Check each as a
NON-ADMIN fulfiller (`itil`), then as a team lead who is a member of one or two groups, then as a CSM agent. What is read:
`src/reports/weekly/read.js`; the columns: `src/reports/weekly/columns.js`; the numbers' definitions are at the top of `read.js`.

The rule of the round: **a number the data cannot give honestly is left out of the view** (the fold "Why are some numbers not shown?" says which
and why), never shown as zero. Each question below says what a "no" does to the screen.

## The week

1. **"This week" and "last week" are Monday to Sunday in the person's own time zone** (their `sys_user.time_zone`, else the browser's, said
   once). Assumed: that is how the team counts a week. Check: a person whose ServiceNow time zone differs from the browser's sees the
   week start at midnight Monday in THEIR zone (compare "Tickets closed" with a list filter `resolved_at` between the same instants). If
   a site counts weeks from Sunday, change `mondayOf` use in `src/reports/weekly/weeks.js` (one place).
2. **"This week so far" is compared with the same days of last week** (Monday 00:00 to the same weekday and time), never with the whole of
   last week. Assumed: that is the fair comparison. Check by eye: on a Wednesday the "closed" of the two periods are about the same size.

## Came in, Closed, Backlog change

3. **Came in = tickets opened in the week; Closed = tickets whose `resolved_at` (incident, case, problem) or else `closed_at` falls in the
   week; Backlog change = came in minus closed.** Both are exact counts from the Aggregate API (`GET /api/now/stats/<table>`), over the
   ticket types of the active dashboard (the same ones the Team screen counts, HR cases never), for the groups of its scope. Assumed:
   (a) `resolved_at` is set when an incident is resolved and is NOT cleared when it is reopened (then a ticket resolved on Monday,
   reopened and resolved again on Thursday counts once, in Thursday's week; if the instance clears it on reopen, a ticket that is open
   again is not "closed" in the week it was resolved in); (b) cancelled tickets get a `closed_at` (else they never count as closed and the
   backlog change reads high). Check: pick one week, count by hand in the classic list with the same filter, and compare. If (b) is wrong
   the backlog is only as honest as "came in minus closed": say so to leads, or add a cancelled-state exclusion.
4. **A ticket type with no closing date is left out of every number, with a note** ("Requested items are not counted: there is no closing
   date to work from."). Assumed: `closed_at` exists on every task type. Check: the note should not appear on a standard instance; if it does,
   the column is hidden from this role (the probe row lacks the key).
5. **Which groups.** The weekly report counts the active dashboard's scope exactly as Team does ("My groups", "Chosen groups"; the first
   25 groups of a person in more). Check: the scope chip under the title matches the one on Team.

## SLA kept (the weekly report) and Answered inside the SLA (My week)

6. **Team: SLA kept = of the `task_sla` rows whose `planned_end_time` falls in the week (not cancelled, not paused), the share with
   `has_breached = false`.** Counted with the Aggregate API on `task_sla` filtered by `task.sys_class_name` and `task.assignment_group`
   (dot-walks the Team screen already uses). Assumed: (a) a plain fulfiller can count `task_sla` rows of tickets in their groups (if not, the
   tile is left out: "SLA information is not available to you" or "you can't see any SLAs at all"); (b) an SLA that completed early but
   whose planned end is next week is counted next week, not this one (acceptable: it is the week it came due); (c) a stage called
   `cancelled` / `paused` exists with those values. Check: pick one SLA definition, count the week by hand in `task_sla_list` filtered the
   same way; check `stage` values on the instance (`sys_choice` for `task_sla.stage`).
7. **My week: Answered inside the SLA = of my tickets closed in the week that had at least one SLA row (not cancelled), the share none of
   whose SLAs has `has_breached = true`.** Read per batch of 50 tickets (`task_sla`, `task IN ...`, columns `task, has_breached, stage`).
   Assumed: `has_breached` is final on a completed SLA. Check against the SLA tab of two closed tickets. If a person cannot see SLAs at
   all (a hidden table answers 200 with nothing) the tile is left out, not shown as 100 percent (`visibility('task_sla')`).
   NOTE the two definitions differ on purpose (rows per week for a team, tickets for a person: the board says "10 of 11 closed tickets").

## Reopened

8. **Reopened = of the tickets closed in the week, those whose `reopen_count` is above zero** (incidents; other types have no such column and are not
   counted, the tile says "of N closed incidents"). Assumed: (a) `reopen_count` exists on `incident` and is incremented when an incident
   moves out of Resolved; (b) it counts tickets that CAME BACK, however much later: a week read right after it ended has had less time
   to see its tickets reopen than the week before it, so the change against the week before is slightly kind to the newer week, and is not
   drawn while the current week is still going. If a site records no `reopen_count`, or hides it, the tile is left out ("does not keep a
   count of reopened tickets"). Check: reopen one resolved incident and see the count go up in the next week's tile.

## My week only

9. **Typical time to resolve = the median of (closing time minus `opened_at`) of my tickets closed in the week.** Calendar time, not
   business time (the board says "1 d 6 h"). Under 3 tickets, or when more tickets were closed than could be read (400 per type), the tile
   is left out and the count alone is shown. Check: compare with a hand calculation for 3 tickets. Business hours would need
   `business_duration`; not used because it is a duration column that some roles cannot read and is not set on every type.
10. **Average first reply = the mean time from `opened_at` to the first customer-visible comment (`sys_journal_field`, `element =
    comments`) written by someone other than the ticket's customer (and not `system`, `guest`, `admin`, `sn_agent`).** Read per batch of 15
    tickets, oldest comment first, only `element_id, sys_created_on, sys_created_by` (no text), the same read My work's "who wrote last" makes.
    Assumed: (a) a plain fulfiller can read `sys_journal_field` rows of tickets they work (My work already needs this); (b) an agent's reply
    is in `comments`, not only in an email that is not a journal entry (inbound email actions write to `comments`; outbound notifications
    do not); (c) the customer's login is readable as `caller_id.user_name` (or the table's own column, `src/mywork/tables.js`); a ticket
    without it is left out of the average (the customer's own comment would count as a reply). Tickets with no reply are NOT counted as
    zero: the average is over the tickets that had one, shown under 3 as nothing. Check: compare with one ticket's activity stream. If
    most replies go out as emails that are not in the journal, the average is based on few tickets or none and the tile is left out; the
    honest alternative is an SLA "response" definition, whose name differs per instance (not attempted).
11. **Where your week went = my closed tickets by `category`** (a type without a category is one bar of its own name, "Requested items").
    Assumed: `category` is a choice list with display values. Check on an instance where categories are customised.
12. **The fix-note counts for "One thing to try"** (closed tickets without notes, and how many of those came back) ask for `close_notes`
    ONLY as "is empty" (`close_notesISEMPTY`) on incidents, problems and cases: no note text is read. The column is probed with one row whose notes are
    empty; if that row comes back without the `close_notes` key the instance has no such column (a condition on an unknown column may be
    ignored, which would make every close look note-less) and the counts are left out. Check on an instance whose resolution notes
    live in another column.

## Needs a decision

13. **Three rules, each shown only when the data supports it** (`src/reports/weekly/figures.js`, `WEEKLY_LIMITS`): (a) one likely cause: a
    `cmdb_ci` shared by at least 3 tickets opened in the week and clearly ahead of the next; (b) load on a few people: the busiest two hold
    at least 40 percent of the open tickets that have an owner (at least 4 owners and 10 tickets); (c) closes without a fix note: at least
    3 and at least a fifth of at least 5 closed tickets. The lines are judgement calls: change them in one place. The load rule counts
    people in groups by the Aggregate API (`assigned_to`) and names no one. Check: does a lead agree these are the three things worth a
    decision? A rule that always or never fires on your instance needs a new line.

## The oldest open tickets (PDF only) and the AI lines

14. **Oldest open tickets**: 8 rows ordered by `opened_at`, with `number, short_description, opened_at, sys_class_name`, and the worst active SLA
    of each (`task_sla`, the columns My work reads). Check: the list matches the classic list sorted by Opened ascending.
15. **The AI lines are written from counts and ticket numbers only** (`src/reports/weekly/ai.js`): no names, no ticket text, no short
    descriptions, no group or configuration item names. The only words from ServiceNow are the areas (categories), cut to a plain label
    first ("Other" for anything that looks like free text). Check in the preview ("What will be sent") on a real week that nothing but numbers
    and categories is there; a category written as a sentence by your instance should show as "Other".
16. **PDF** is the browser's own print of an A4 page (`window.print()` with a print style sheet; no library). Assumed: the side panel and the
    Firefox sidebar can call `window.print()`, and Save as PDF is one of the printer choices (Chrome, Edge, Firefox: yes). Check in each
    browser that only the report is printed (not the panel) and that it is one A4 page; if a browser prints nothing from the side panel,
    the full-page dashboard (`dashboard.html`) is the place to move the button to.
