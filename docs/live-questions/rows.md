# Live questions: the five-row first screens of My work and Team (round 5, docs/round5.md)

What the rows assume about a real ServiceNow site that no test could check. Nothing here has been checked on a real instance: the
numbers come from reads the screens already made (`src/mywork/read.js`, `src/reports/engine/*`), so the first six assumptions are about
what those reads return, not about new reads. Question 7 is a measure that is NOT built because it needs a new read.

How to check as a non-admin: open the screen, open the row, and compare with ServiceNow's own list (the "All N open tickets, with filters"
view and "All team charts and tables" give the same numbers in more detail, and each ticket links to the list it came from).

## 1. "Customer waiting" on My work's first row

- **Assumed:** a customer (or, where the customer is not known, someone else) who wrote after my last customer-visible comment and has had
  no answer for 2 days or more (`RISK_LIMITS.waitingDays`, `waitingOnYouDays` in `src/mywork/risk.js`: authors and times of comments
  only, never their text) is "a customer waiting for your answer". Fresher replies are on the third row ("Replied to you"). Each ticket
  is counted once, on the first of the rows Needs you now, At risk today, Replied to you.
- **Check:** open an incident where the caller commented 3 days ago and you did not answer: it must be on "Needs you now". One where the
  caller wrote an hour ago must be on "Replied to you".
- **If wrong:** the limit is one number (`RISK_LIMITS.waitingDays`); the comment read is the one the "Customer replied" chip already uses.
  When comments cannot be read at all, the rows say "could not be checked" / "could not be read" instead of a number.

## 2. "At risk today" counts only what the existing "At risk" rule finds

- **Assumed:** the rule of `src/mywork/risk.js` (SLA nearly used or breached, reopened, reassigned 2+ times, waiting on you, VIP, priority
  account) is what a person means by "at risk today". The first row takes the breached and the waiting ones, so this row shows
  "close to breaching", "reopened or handed on often" and "for an important customer".
- **Check:** one ticket with an SLA at 80 percent, one reassigned three times: both on this row, neither on "Needs you now".
- **If wrong:** change `riskKind` / the lines in `src/sidepanel/mywork/rows.js`; the rule itself is not touched.

## 3. "Same cause?" is a configuration item shared by three or more of my open tickets

- **Assumed:** the existing hint (`sharedCis`, `min = 3`) answers "same cause?". Only my own queue is looked at. Tickets with no
  configuration item (or an item this person cannot read) never form a cluster.
- **Check:** three of your incidents on one configuration item: the row shows 3 and the name.

## 4. Team: "Needs attention now" counts the SLAs, not the tickets that are listed

- **Assumed:** the number is the SLA source counts of the attention section (`counts.breached.population` + `counts.closest.population`:
  tickets with a breached SLA, and tickets not breached whose SLA is nearly used up or due within 4 hours: "about to breach"). The
  tickets under it are the attention rows of those two reasons (the engine lists at most eight tickets in all, so a longer list says
  "Showing 4 of 11").
- **Check:** compare with "SLA risk radar" in All team charts and tables (breached and at risk).
- **If wrong:** the section's own counts decide; nothing is computed on the screen.

## 5. Team: "Coming back again" uses the Quality section's top configuration item of the last 30 days

- **Assumed:** the configuration item with the most tickets opened in the last 30 days (closed ones included), with 3 or more tickets, is
  "one cause?" (`src/reports/engine/quality.js` `cis`). Else callers with 3 or more tickets in 30 days. Else "No cause stands out".
- **Weak point:** the engine cannot say "no ticket type here has a configuration item column" apart from "no item stands out", so the
  calm line may be said where the item could not be read at all. Only the incident, problem and change tables offer `cmdb_ci` to the
  Quality section; a team that works only requests or cases always gets the calm line.
- **Check:** on a site with a known repeat item, the row names it; open "Quality and trend" in All team charts and tables and compare
  "Top configuration items".
- **If wrong:** have the Quality section say when no table offered the item (a `ciRead` flag) and show "could not be read" then.

## 6. Team: "Who is carrying the load" and "Getting old"

- **Assumed:** "The busiest N people hold P percent of the open tickets" is the open tickets of the busiest two people (the engine's own
  open-by-person counts, resolved-but-not-closed left out) divided by the open total; names only inside the opened row. "Getting old" is
  the open tickets opened 8 or more days ago (the 8-14 and 15+ buckets of the Workload section), and those of 15 days or more.
- **Honesty cases:** a team view whose per-person read gave nothing at all says "Could not be read", not "nobody carries anything"; a
  view of my own tickets says "Only your own tickets are in this view".
- **Check:** compare with "Open work by person" and "How long tickets have been open" in All team charts and tables.

## 7. NOT BUILT: "closes without a fix note" (Team, "How well tickets are closed")

- **Wanted:** "3 of 14 closed this week have no fix note" (board C).
- **Why not:** the Quality section does not read the closing notes; the closed vocabulary of the report builder has no "closing notes are
  empty" filter; and `src/reports/engine/*` and the reports spec are not in this change's files.
- **What the row says now:** the tickets that were reopened ("3 of 40 tickets opened in the last 30 days were reopened", the Quality
  section's reopen count), and inside the opened row "Closing without a fix note is not counted here yet."
- **To add it:** in `src/reports/engine/quality.js` count, per table that has the column (`close_notes`: incident, problem, change request,
  catalog task, customer service case), the tickets resolved in the last 7 days (`resolvedColumn`) and those among them with
  `close_notesISEMPTY` (Aggregate API, GET only), add `close_notes` to the `optional` columns of those tables in
  `src/reports/engine/constants.js`, and return `closeNotes: { without, of }` (null when a table could not be counted). The row already
  reads `closeNotes` when it is there (`closedRow` in `src/sidepanel/team/rows.js`) and then says "N of M closed this week have no fix note".
- **Check as a non-admin:** an Aggregate count with `close_notesISEMPTY` on `incident` must be allowed for the role (the column's read
  rule applies); if it is hidden the count would be wrong, so the engine must treat a hidden column as "could not be read".
