# My work and Team

My work is for the person who works tickets. Team is for team leads and managers. Both read only, with your own ServiceNow session. Where this guide says "not verified", the assumption behind a number passed the automated tests against a fake ServiceNow but has not yet been checked on a real instance.

## My work

My work shows what is assigned to you, in five rows. The line under the title says "Stays in ServiceNow. Nothing is sent anywhere." There is no AI half on this screen, except one optional AI line in My week. It is shown to every work profile unless the organisation hides it (policy `disabledSections` with `mywork`).

Everything on the first screen is worked out from one read the screen already made, with GET requests only. ServiceNow's own access rules decide what comes back. Nothing is stored; the answer lives in the panel until you close it.

### The first screen: summary line and five rows

- **What it shows:** The title "My work", when it was read ("Read just now") with a **Refresh** button (it becomes **Stop** while reading), one summary line such as "6 open tickets. 2 need you first.", and five rows: "Needs you now", "At risk today", "Replied to you", "Waiting on others", "Same cause?". Under them two quiet rows: "All {n} open tickets, with filters" and "My week". Each row has an icon, a title, one sentence, a small count, and a dot (red for danger, amber for warn). A ticket is counted once, on the first of "Needs you now", "At risk today", "Replied to you" that it fits.
- **How to use it:** Tap a row to open it; "Needs you now" opens by itself when it has tickets. Tap a ticket to open it; the panel moves to the Ticket screen (Ctrl+click opens a new tab). The screen reads again by itself after 5 minutes. If a read takes over 3 seconds it says "Waiting for ServiceNow to answer" and you can press **Stop**.
- **Reads:** your assigned tickets (number, title, priority, state, hold reason, dates, configuration item, group), their SLAs, and who wrote the newest customer-visible comments and when. Comment text is never read. Tables the organisation blocks are not read; HR cases are listed only when the HR profile is on and the organisation allows HR content.
- **Limits:** Up to 200 tickets per kind and 12 kinds; a longer list says "Showing {shown} of {total}." with a link to ServiceNow's own list. A row that cannot be read says so ("Could not be read.", "Replies could not be read.") and is never a zero. When SLAs cannot be seen, tickets are ordered by priority and it says so. Not verified: that a plain fulfiller can use the Aggregate API on `task`, read comment markers and read `task_sla` (fallbacks are in place and say what they could not do).

### Needs you now

- **What it shows:** Tickets with a breached SLA, or where a customer wrote and has had no answer from you for 2 days or more. Line example: "2 SLAs breached · 1 customer waiting for your answer", or "Nothing is breached and no customer is waiting." Red dot when breached, amber when only customers wait.
- **How to use it:** Open the row for the first 2 tickets, then "Show all ({n})". Each shows number, title, a status chip ("Customer replied", "Waiting on customer"), SLA time, priority P1 to P5, and the "At risk" chip and reasons when they apply.
- **Limits:** The 2-day line is one number in the code and has not been checked with real agents. If comments cannot be read it says so and never claims "no customer is waiting". Not verified: that customers are matched correctly (comments added by email may carry a system user as author).

### At risk today

- **What it shows:** Tickets that are "At risk" by the rule below but not already in "Needs you now". Counts: "{n} close to breaching", "{n} reopened or handed on often", "{n} for an important customer".
- **How to use it:** Open the row and work from the top; each ticket has the "At risk" chip and a reason line.
- **Privacy:** No AI and no ticket text. Reasons use counts and flags ServiceNow stores. The "priority account" reason needs the organisation's list of account names in policy `priorityAccounts` (ServiceNow has no standard column); without it the reason never appears.
- **Limits:** "Close to breaching" means an SLA 75 percent used, or under 2 hours left on a running SLA. A paused SLA is never close to breaching; a resolved ticket is never at risk. Not verified: that the rule matches what your people mean by "at risk today".

### The "At risk" chip and its reasons

- **What it shows:** An amber chip on a ticket and one line naming the reasons, for example "Reassigned 3 times · waiting on you 2 days". A ticket is at risk when any of these holds: reopened at least once; reassigned 2 or more times; the customer wrote after your last comment 2 days ago or more; the SLA is breached or nearly used; the caller is VIP; the case belongs to a priority account.
- **How to use it:** In the full list "At risk" is also a filter with its count, and at-risk tickets come first in every group.
- **Limits:** The thresholds are fixed in the code, not settings. A fact your role cannot read is not used, and the screen counts those tickets and says so.

### Replied to you

- **What it shows:** Tickets where the customer (or someone else, if the customer is not known) wrote after your last customer-visible comment, less than 2 days ago. "No one has written back since your last comment." when none.
- **How to use it:** Open the row and answer from the ticket. Tickets waiting 2 days or more are in "Needs you now" instead.
- **Limits:** A ticket whose comments could not be read has no marker. Not verified: how comments that arrive by email show up as authors.

### Waiting on others

- **What it shows:** Your tickets that are on hold, or waiting on the customer or somebody else, with nobody writing since: "{n} tickets, waiting longest {span}".
- **How to use it:** The longest-waiting ticket comes first, so it is the first to chase. The chip says "Waiting on customer" or "On hold: {reason}".
- **Limits:** The meaning of each state is decided in one place; a state that is not recognised counts as live work. Not verified on customised state lists.

### Same cause?

- **What it shows:** A hint when three or more of your open tickets share one configuration item: "{count} of your tickets are on {name}. One cause?"
- **How to use it:** Open the row for up to 3 groups; "Show them" opens the full list filtered to that item.
- **Limits:** Tickets with no configuration item (or one you cannot read) never form a group. It only says "maybe one cause"; it does not open a problem.

### All {n} open tickets, with filters

- **What it shows:** The full My work screen. A bar with the read time, a tick box "Every 5 min" and Refresh; "My queue" with a summary ("12 open, 2 SLA breached, 3 replied"), filter chips and the tickets in groups (the first 5 that need you, then folds "Waiting on the customer or others" and "Resolved, awaiting closure"); plus the cards "Approvals waiting on you", "Follow-ups due" and "Unassigned in my groups". Filter chips, shown only when they would show something: "At risk", "SLA breached", "SLA at risk", "Replied", "On hold", "P1", "P2", and the ticket kinds. Three show first, the rest sit behind "More filters". One filter is on at a time.
- **How to use it:** Press a chip to narrow the list, "Clear the filter" to return, "Back" to the five rows. Order: at risk first, then breached SLA, SLA at risk, customer answered, then priority.
- **Limits:** The same caps as the first screen. The full list and the five rows always agree.

### Approvals waiting on you

- **What it shows:** Approvals assigned to you in state "requested", with number, title, when asked and when due; an overdue one has an amber dot. Only shown when there are some.
- **How to use it:** Click one to open it. The first 3 show.
- **Limits:** Approvals delegated to you by someone else are not included. This card moved off the first screen in round 5; whether it should come back as a row is an open decision.

### Follow-ups due

- **What it shows:** Tickets where the customer is owed a word, with the reason: "Customer replied 2 d ago", "Waiting on the customer {n} d", "No update to the customer in {n} d". Only for ticket kinds that reach a customer.
- **How to use it:** Choose "Follow up after": 2, 3, 5 or 7 days (default 3; setting `followUpDays`). On a reminder or status update press **Copy draft**: a short fixed text with only the ticket number and title. Nothing is sent.
- **Privacy:** No AI. No names, nothing from the comments.
- **Limits:** If comments cannot be read it says so and claims nothing.

### Unassigned in my groups

- **What it shows:** Tickets in your groups that nobody owns, with a summary such as "12 waiting, oldest 3 d". Ready work comes before work on hold; breached and at-risk SLAs first, then priority, then longest wait.
- **How to use it:** Open a ticket from the list; the first 3 show, then "Show all".
- **Privacy:** No AI. Reads your group memberships and the unassigned active tickets of those groups (up to 50 per kind). If your memberships are not visible it says so.
- **Limits:** Only your own groups. Like approvals, it moved off the first screen in round 5 (open decision).

### My week

- **What it shows:** Your own week in five numbers, where it went, and one thing to try. Opened from "My week" at the foot of My work. A choice "This week" / "Last week", Monday to Sunday in your own time zone; "This week" is compared with the same days of last week. The numbers, for tickets assigned to you: **Tickets closed** (with the change on last week); **Average first reply** (opening to the first customer-visible comment by someone other than the customer); **Typical time to resolve** (the median, in calendar time); **Reopened after closing** (for example "1 of 11"); **Answered inside the SLA** (for example "91%", "10 of 11 closed tickets that had an SLA"). Under them **Where your week went**, bars of your closed tickets by category (up to 5 plus "Other").
- **How to use it:** Press "My week", switch week with the two buttons, **Refresh** to read again, "My work" to go back. Only you see it unless you share it.
- **Privacy:** The numbers need no AI. GET only: counts and a few columns of the closed tickets (up to 400 per kind), their SLAs, and for first reply only author, time and ticket of comments. Close notes are read only as "is it empty". HR tables are never read. Honours `blockedTables` and the `reports` switch.
- **Limits:** A number the data cannot give honestly is left out, never zero, and a fold "Why are some numbers not shown?" says why: under 3 tickets there is no typical time or average; no reopen count on the site; no SLA. A ticket you resolved and handed on is not counted. The first-reply measure is not verified on a real instance.

### One thing to try (AI)

- **What it shows:** One short suggestion for next week (at most 40 words), written by the AI from your own week's counts, with "Written from counts and ticket numbers. No names, no ticket text." and a link "What was sent".
- **How to use it:** Press **Write one thing to try**. You see a preview of exactly what will be sent, every time. **Write it again** asks again.
- **Privacy:** Uses AI (feature id `my-week-tip`) through the same firewall, preview and audit as every AI action. Sent: counts and ticket numbers only; no names, groups, configuration items or descriptions. Off when the organisation disables it or AI, when you chose "Skip AI for now", or when there is no key. The numbers do not wait for it.
- **Limits:** It only has what the counts say; it cannot know why a ticket was reopened, and it cannot compare you with other people.

### Share with my lead and Download PDF

- **What it shows:** **Share with my lead** copies a plain-text summary to the clipboard. **Download PDF** opens the browser's print dialog on an A4 page made from the same numbers; choose "Save as PDF".
- **Privacy:** Nothing is sent by Agent Buddy; you decide where the text goes. No new library, permission or address.
- **Limits:** Not verified: that printing works from the side panel and the Firefox sidebar onto one A4 page. There is no CSV for My week.

## Team

The Team screen is for team leads and managers. It is shown to the Team lead work profile (worked out from roles, or from managing an assignment group; also choosable in Settings) and to everyone when "Show everything" is on. The organisation can hide it (`disabledSections` with `team`) or switch reporting off (`disabledFeatures` with `reports`). It has two halves: **Insights** (numbers, no AI) and **AI Assist** (hand-over note, "Explain this dashboard", coaching snapshot). The AI half is hidden when the organisation switches AI off.

Insights shows five rows and a **Weekly report** button first, then "All team charts and tables" for the full dashboard. The rows read the same data as the full dashboard and agree with it. Names of people show only inside an opened row.

### The first screen: scope, summary and five rows

- **What it shows:** The title "Team" with a scope chip ("Mine", "My groups (3)", "Chosen groups (2)"), a summary line such as "38 open tickets. 5 need a lead today.", "Read at 15:36" with **Refresh**, the **Weekly report** button ("One click. Ready to send to your manager."), five rows ("Needs attention now", "Getting old", "Who is carrying the load", "Coming back again", "How well tickets are closed") and "All team charts and tables". Notes about the numbers sit in a fold.
- **How to use it:** Press the scope chip to change whose tickets and which ticket types the whole screen counts. Tap a row to open it; the first opens by itself when it has tickets. Coming back after 5 minutes reads again.
- **Privacy:** No AI on this half. GET only: counts from the Aggregate API, a few columns of listed tickets, SLAs. Honours `blockedTables`; HR cases only with the HR profile and `allowHrContent`.
- **Limits:** A row that could not be read says so and has no number; never a zero. Open decision: whether per-person rows (names inside an opened row) are for managers only. Today nothing is gated.

### Needs attention now (row)

- **What it shows:** Tickets with a breached SLA plus those about to breach (SLA nearly used, or due within 4 hours): "3 breached, 2 about to breach". Red dot when breached, amber when about to.
- **How to use it:** Open it for the first 2 tickets with a reason chip ("Breached", "Closest to breaking"), when the SLA ends, who holds it and the priority; "Show the other {n}" for more (at most 8 listed).
- **Limits:** Not verified: that a plain lead can count `task_sla` with dot-walked conditions.

### Getting old

- **What it shows:** Open tickets opened 8 or more days ago: "{n} open for more than 7 days, {n} for 15 days or more".
- **How to use it:** Open it for age buckets (0-1, 2-3, 4-7, 8-14, 15+ days), the count with no update in 3 or more days, and up to 3 of the oldest tickets.
- **Limits:** Age counts from the opened date. A ticket type that could not be aged is left out and said.

### Who is carrying the load

- **What it shows:** How much of the open work the busiest two people hold: "The busiest 2 people hold 40% of the open tickets".
- **How to use it:** Open it for "Open tickets by person" (top 5 with counts, names shown only here) and the count with nobody assigned.
- **Limits:** A view of only your own tickets says so. The percent is not a measure of fairness.

### Coming back again

- **What it shows:** One likely repeat cause: the configuration item with the most tickets in the last 30 days, when it has 3 or more: "{name}: {n} tickets in the last {days} days. One cause?". Otherwise callers with 3 or more tickets.
- **How to use it:** Open it for the top 5 configuration items and the repeat callers (names shown only here). Useful as input to a problem record.
- **Limits:** Only incident, problem and change tables offer the configuration item, and only incidents offer the caller, so a team that works only requests or cases always gets the calm line. Not verified on a real instance.

### How well tickets are closed (partly built)

- **What it shows:** Today, how many tickets came back: "{n} of {total} tickets opened in the last {days} days were reopened", with an amber dot from a 10 percent reopen rate.
- **How to use it:** Open it for "Resolved in the last {days} days", "Time to resolve" and "Reopened".
- **Limits:** Not built yet: "N of M closed this week have no fix note". The row says "Closing without a fix note is not counted here yet." The Weekly report does count it.

### Weekly report

- **What it shows:** The week in short for a lead to send to a manager. A choice "Last week" (default) or "This week so far", Monday to Sunday in your own time zone. In order: an optional AI paragraph "The week in short", five numbers, "Compared with the week before.", "Needs a decision" and the buttons. The numbers: **Came in** (tickets opened), **Closed** (resolved, else closed), **Backlog** (came in minus closed, labelled worse, better or no change), **SLA kept** (share of SLAs that came due that were not breached) and **Reopened**. "Needs a decision" lists up to three rules, shown only when the data supports them: open a problem for one likely cause (3 or more tickets on one configuration item); two people hold 40 percent or more of the open work, rebalance; closes without a fix note (at least 3 and a fifth of at least 5 closed tickets). Otherwise "Nothing in the numbers needs a decision this week."
- **How to use it:** Press **Weekly report** on Team, choose the week, **Refresh** to read again, "Team" to go back. It counts the same groups and ticket types as the Team screen (at most 25 groups).
- **Privacy:** The numbers need no AI and never wait for the paragraph. GET only. HR tables are never read. Nothing is stored. The load rule counts people but names no one.
- **Limits:** Numbers the data cannot give honestly are left out, never zero, with a fold saying why. "SLA kept" counts SLA rows, not tickets (My week counts tickets; the definitions differ on purpose). Not verified on a real instance: the week definitions, behaviour of the resolved date on reopen, whether a plain fulfiller can count `task_sla`. The "Needs a decision" rules are judgement calls that have not been tested with a lead.

### The week in short (AI paragraph)

- **What it shows:** One short paragraph (at most 70 words): what came in against what was closed and what that did to the backlog, how the SLAs went, and the one thing most worth a lead's attention. Under it "Written from counts and ticket numbers. No names, no ticket text." and a link "What was sent".
- **How to use it:** Press **Write the week in short**; the preview shows every time. **Write it again** rewrites it. It goes into the PDF and the email copy. When the week changes it is cleared.
- **Privacy:** Uses AI (feature id `weekly-summary`), through the same firewall, preview and audit. Sent: counts, areas as plain category labels, up to three findings and ticket numbers; no names of people or groups, no descriptions, no comments. The prompt forbids blaming or ranking anyone.
- **Limits:** It only repeats and arranges the numbers. "AI can be wrong. Check the text before you use it."

### Weekly report: PDF, CSV and copy for email

- **What it shows:** Three buttons. **Download PDF** opens the print dialog on an A4 page: the site, "Weekly report", period and scope, the paragraph, the five numbers, "Closed by area", "Needs a decision", the table "Oldest open tickets" (ticket, short description, age, SLA) and "Numbers read from ServiceNow on {date} at {time}. Nothing was changed." **Download CSV** saves the same tables. **Copy for email** copies plain text (without the oldest tickets).
- **Privacy:** Made in your browser; nothing is sent by Agent Buddy. The report holds no person names, but the oldest-tickets table holds short descriptions as written in ServiceNow, which can contain names: read the PDF and CSV before sharing.
- **Limits:** Not verified: that printing works from the side panel and the Firefox sidebar. The fallback is the full-page dashboard.

## Team: the full dashboard

### All team charts and tables

- **What it shows:** The complete Team overview, one tap below the five rows. A top row with a drop-down for the dashboard's name, the scope chip and a "⋯" menu (Refresh, Refresh every 5 minutes, Customize, Add your organisation's dashboard, Export, Print or save as PDF, Open full page). A status line "Read at {time} · {n} ticket types". Under it the dashboard's sections; each has its own "⋯" menu ("Show as tables"; while customizing also Move up, Move down, Edit, Remove). A fold collects every note about numbers that could not be read, once.
- **How to use it:** Press "All team charts and tables" on Team; "Back" returns. Numbers and bars are links: a click opens the matching list in ServiceNow; Ctrl+click opens a new tab.
- **Privacy:** No AI. GET only. Honours `blockedTables`, `blockedFields`, the HR rule and `reports`.
- **Limits:** Numbers are cached for about a minute; **Refresh** clears that. A section that could not be read says so in its own place; every cap says so. Nothing is "none" unless every source was read in full.

#### Section: Needs attention now

- **What it shows:** The few tickets that most need a lead, each with one strongest reason: "Breached", "Closest to breaking", "Waiting for approval", "Reassigned {n} times" (3 or more), "Oldest open" (15 days or more), "Customer waiting". Other reasons show as "+{n} more reasons". At most 8 rows, with SLA end, percent used, owner and priority.
- **Limits:** Never says "Nothing needs attention right now." unless every source was read in full.

#### Section: Overview

- **What it shows:** Tiles for how the queue stands: "Open", "Resolved, not closed", "Due soon" (SLA ends within 4 hours), "Breached", "Unassigned", "No update in 3+ days", "Waiting", "Opened today", "Resolved today", and a fold "By ticket type".
- **How to use it:** A tile with one list behind it is a link; one with several offers "Open in ServiceNow:" per ticket type. Tiles that mean "look at this" turn amber or red.
- **Limits:** "Today" uses your ServiceNow time zone (or the browser's, said in a note). If the SLA read stopped early the tile says "12+". Not verified on a real instance.

#### Section: Workload and ageing

- **What it shows:** "Open work by person" and "by group" as stacked bars, "Ageing of open work" (0-1, 2-3, 4-7, 8-14, 15+ days) and "Tickets reassigned 3+ times".
- **How to use it:** Click a bar or cell to open that list in ServiceNow. Ageing and reassigned parts are folded.
- **Privacy:** This is where individuals' open work shows by name (see the open decision on per-person rows).
- **Limits:** "No update in 3+ days" can be changed per section only in a layout file, with no control on screen.

#### Section: SLA risk radar

- **What it shows:** "Closest to breaking": tiles for at risk (75 percent or more used), then the 10 closest tickets with SLA end, percent used, owner and priority; folded "Who holds the risk" with bars by owner and group.
- **Limits:** If ticket details cannot be read, counts only; details are looked up for the 200 most worrying tickets. A paused SLA is never "due soon". Not verified: dot-walked conditions in the SLA query.

#### Section: Quality and trend

- **What it shows:** Tiles for the last N days: Opened, Resolved, Time to resolve (mean, with median in the hover text), Reopen rate (amber from 10 percent), Reassignments. Charts "Opened and resolved per day" or "per week" and "Open tickets at the end of each period (estimate)", then top categories, top configuration items and callers with 3 or more tickets in 30 days.
- **How to use it:** The "Period" menu: last 14 days, 30 days (default), 8 weeks, 12 weeks. Saved with the dashboard.
- **Limits:** Where a read stopped early the oldest periods say "only partly counted". Reopen count and caller exist for incidents only; categories for incident, case, problem and change.

#### Section: Request fulfilment

- **What it shows:** "Approvals waiting" (waiting for your approval; holding up the team), "By state" for requested items and catalog tasks, "Other kinds of ticket" and "Oldest open items".
- **Limits:** Delegated approvals are not included.

#### Section: Shift handover (the tables)

- **What it shows:** What a lead gives to the next shift as numbers and lists: Open, Breached, At risk, Due soon, Unassigned, No update in 3+ days; "Waiting on others" (on the customer, on an approval, on hold, "Waiting the longest"); lists of what happened in the period (priority 1-2 opened and resolved, SLAs breached, handed over 3+ times); "Oldest open".
- **How to use it:** Choose 8, 12 (default) or 24 hours. The ready-made dashboard "Shift handover" holds only this section.
- **Limits:** "Handed over 3+ times and touched" is an approximation (the reassignment count is a lifetime total). Not verified on a real instance.

### AI Assist half of Team

#### Hand-over note (AI)

- **What it shows:** A short note for the next shift written from the hand-over numbers, at most 220 words, under five headings: "Headline:", "Needs attention now:", "Waiting on others:", "Watch during the next shift:", "Notes for the incoming team:". "Not stated" under a heading the data does not cover. **Copy** and **Print**; no Insert, because it is a team note.
- **How to use it:** In AI Assist open "Hand-over note", choose 8, 12 or 24 hours, press **Write the hand-over note**, read the preview of exactly what will be sent. The screen then checks the length and missing headings.
- **Privacy:** Uses AI (feature id `shift-handover`). Sent: counted figures, group names, plain notes and up to 15 notable tickets with number, type, priority, state, group, assignee and short description. Assignees and requesters are masked; a person named only inside a ticket title is not, and the screen says so. Off when the organisation disables it or AI, you skip AI, or there is no key.

#### Explain this dashboard (AI)

- **What it shows:** An explanation of the numbers the lead is looking at, headed "What the numbers say": "What stands out:", "Likely reasons (hypotheses):", "Suggested actions:", at most 220 words. It first states what it is based on and which sections are missing.
- **How to use it:** Press **Explain these numbers**, read the preview, read the answer (**Copy**, **Print**). It explains the active dashboard; change that in Insights.
- **Privacy:** Uses AI (feature id `dashboard-insights`). It reads nothing from ServiceNow itself; it takes the results already loaded. Sent: counts, trends, group names, ticket numbers and masked assignees; no titles, descriptions, callers' names or notes. Custom reports are left out.
- **Limits:** The reasons are hypotheses. Not verified with a real AI endpoint.

#### Coaching snapshot (opt-in, off by default)

- **What it shows:** A rubric review of a sample of tickets one group resolved, for its team lead: "Group themes:" and "What the group does well:", rating completeness of notes, clarity, tone and follow-through. The screen says it is "a coaching aid for the team lead only, not a performance rating".
- **How to use it:** In AI Assist open "Coaching snapshot", choose one group, a first and last day (at most 92 days) and the number of tickets (4, 6, 8 or 10). **Pick the sample**, then **Write the coaching snapshot**. If the answer seems to rank or name individuals it is held back behind a warning.
- **Needs all of:** the organisation sets `coachingEnabled` to true, the person is in Strict or Local-only privacy mode, and the organisation does not block `close_notes` or `comments`. A group with fewer than 3 visible people is refused. `docs/deployment.md` suggests keeping it disabled until HR or works-council sign-off.
- **Privacy:** Reads, for the sampled tickets only, close notes, close code and customer-visible comments by the group's agents. Work notes are not read; HR cases are never used. The AI is told never to name, score, rank or compare an individual, and the answer is checked for it. Nothing is stored.
- **Limits:** The per-person check is a local heuristic that can miss. The sample is a fixed rule, not a statistical sample.

### Settings of the Team dashboard

#### Whose tickets and which ticket types (scope)

- **What it shows:** A panel under the scope chip: "Whose tickets" with "Mine", "My groups", "Chosen groups"; and a fold "Ticket types: {n} of {total} available" with a tick box per kind. A kind you cannot use says why.
- **How to use it:** Press the scope chip and choose. "Chosen groups" opens a group search; keep at least one. The choice is saved with the dashboard and applies to the five rows, the full dashboard and the Weekly report.
- **Limits:** A scope holds at most 25 groups (the ones with the most open work are used, and it says so). An empty scope reads nothing.

#### Report builder (custom report)

- **What it shows:** A custom report for a dashboard: one ticket type, filters from a fixed list ("Open", "Assigned to me", "In my groups", "Unassigned", "SLA breached", "Opened" in the last 7, 30 or 90 days), one grouping, one measure ("Number of tickets", "Average days to resolve", "Average age of open tickets") and a chart type ("Bars", "Donut", "Line over time", "Numbers only"). There is no free-text query.
- **How to use it:** "⋯" > "Customize" > "Add custom report", choose, **Preview**, **Add to dashboard**. Edit later from the section's menu.
- **Privacy:** No AI. Only the configuration is saved, never numbers. Grouping by "Assigned to" shows names.
- **Limits:** Averages come from up to 3000 tickets and say how many. At most 24 widgets per dashboard.

#### Saved dashboards, Customize and the organisation's dashboard

- **What it shows:** Dashboards you can switch between: "My numbers", "Team overview" and "Shift handover" ready-made. A team lead starts on "Team overview", anyone else on "My numbers". Each ServiceNow site has its own. At most 12 dashboards with 24 sections each.
- **How to use it:** "⋯" > "Customize" to rename, add sections or a custom report; "More" holds New dashboard, Save layout as a file, Load a layout file and Remove this dashboard. The layout file holds no numbers and no tickets.
- **Privacy:** Stored in the browser on this computer: configuration only. The organisation can publish one layout for everyone with policy `defaultDashboard`; it becomes the person's own copy and is never a lock.

#### Export (CSV and copy, names masked)

- **What it shows:** "⋯" > "Export": **Download all as CSV**, **Copy all as a table**, a tick box **Mask names and emails**, and a fold for one section.
- **How to use it:** Tick the mask if the file leaves the team, then download or copy. With the mask on, people become "Person 1", "Person 2" (the same person keeps the same number within one export) and email addresses become "[email]". A name written only in free text is found when the words around it mark it. The card warns "Check the file before you share it."
- **Limits:** A name with no cue around it can still be missed in Standard mode. The mask starts off. It changes the file only; names on screen stay.

#### Print or save as PDF, and the full-page dashboard

- **What it shows:** "⋯" > "Print or save as PDF" prints the dashboard as it is on screen (choose "Save as PDF"). "Open full page" shows the same dashboard in a browser tab of its own with room for several columns.
- **How to use it:** Team > "All team charts and tables" > "⋯" > "Open full page". It reads through the ServiceNow tab it was opened for, which must stay open; if the tab was closed it says so. Dashboards saved in the panel and on the page stay in step.
- **Limits:** The AI half, the five rows and the Weekly report are only in the panel. Printing is not verified in the side panel and the Firefox sidebar.

#### Honest limits: "could not be read"

- **What it shows:** The rule of the whole Team and My work side: a number that cannot be read honestly shows as "Could not be read.", "Not available to you", "at least {n}" or "{n}+", or is left out with a reason, and never as zero or "none". A fold lists each note once.
- **Limits:** A section has a 45-second limit; a slow instance gives up with "Some numbers took too long to read and are missing." rather than hang.
