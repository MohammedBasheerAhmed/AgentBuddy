# Knowledge manager: what was assumed (wave 6 of the audit of 2026-11-07)

Area: the Knowledge screen's Insights half for knowledge managers, at the size of a real knowledge base: the duplicate finder
(`src/sidepanel/knowledge/DuplicatesPanel.jsx`, `src/context/knowledge.js` `readKnowledgeList`, `src/knowledge/similarity.js`) and the
knowledge-gap radar (`GapsPanel.jsx`, `readResolvedTickets`, `src/knowledge/gaps.js`). The tests that pin the rules are
`tests/km-list.test.js` (the reads at the size of a real base), `tests/km-coverage.test.js` (what the lines say, and the rule that
"No duplicates found." is never said about a base that was not all compared), `tests/km-panel.test.js` (the screen, driven), and
`tests/km-surfaces.test.js` (classic, Workspace, portal, no ticket).

What was built, in the person's words:

- Every duplicate result starts with one plain line: "Compared 300 of 1,240 articles in IT Knowledge Base." It is never missing, and
  "No duplicates found." is said only when everything in the scope was compared; otherwise "No duplicates among the 300 compared." When
  the total cannot be counted the line says "of an unknown number" and nothing is called complete.
- "Compare the next 300" (a quiet button) adds the next 300 titles to the ones already compared, up to 1,500 in one scan. Past that, and
  when the instance's count is not reached, the panel says so and, for a whole base, points to the category picker: a category is a scan
  of its own, with its own count.
- Each group says in one line why it is a group, from what the grouping really uses (the words of the titles), and each gap topic says
  "3 tickets, 2 with a written fix". The gap line says "Looked at the newest 500 of an unknown number of tickets" when it was cut and
  could not be counted.

The questions below are for a real knowledge manager on a real base, one per assumption, with what each answer changes. The first
four are about the size of the base and the counts; the others are about the quality of what is found. Console snippets print numbers
only, never article text. Run them in an already signed-in tab on the instance.

## A. Size and counts

1. **How big is your base?** Assumed: a typical customer has one to five knowledge bases of 200 to 3,000 published articles, and the
   biggest category holds a few hundred. Ask: how many knowledge bases, how many published articles in the largest, how many categories
   in it, and how many articles in the biggest category. Console, as a knowledge manager:
   `const g = await (await fetch('/api/now/stats/kb_knowledge?sysparm_count=true&sysparm_group_by=kb_knowledge_base&sysparm_query=workflow_state%3Dpublished', {credentials:'same-origin', headers:{'X-UserToken': window.g_ck}})).json(); console.log(g.result.map(r => [r.groupby_fields[0].display_value, r.stats.count]))`
   (use `g_ck` from a classic page, or the token the extension sends). What changes: if the largest base is above about 1,500, the whole-
   base scan will stop at the cap on every use and the category route is the main route, not the fallback: the picker should then offer
   a "next category" shortcut and remember which categories were compared. If most bases are below 300, the line "Compared 120 of 120
   articles" is all anyone sees and the paging could be hidden. Nothing in the code needs to change for either until this is answered.

2. **Does the count include articles the manager cannot read?** Assumed (from docs/live-checks-2026-11-07.md: the total of a read
   ignores row filtering): the Aggregate API count can be higher than what the person may read, so "Compared 650 of 1,000" can happen with
   no fault, and the panel then says "The other 350 could not be read; your role may hide them." Check: as a knowledge manager whose
   role is narrower than the base's contributors (or as a plain agent with `itil` only), compare the count above with how many articles
   the base's own list view shows for the same filter (`kb_knowledge_list.do?sysparm_query=workflow_state=published^kb_knowledge_base=<id>`,
   the footer says "1 to 20 of N"). If the list view's N is the same as the Aggregate count even when the Table API returns fewer rows,
   the count is not the problem and the hidden rows are (see question 3). If the list view's N is smaller, the count is simply not what
   the person can see: the sentence should then say "ServiceNow counts 1,000 here; you can open 650", not "could not be read". What
   changes: the wording of one hint (`duplicatesCoverage`, `src/sidepanel/knowledge/coverage.js`) and its Arabic.

3. **Does a page come back short when a row rule hides some of its rows?** Assumed: yes. The Table API applies the limit first and the
   row rules after, so a window of 300 can return, say, 250 rows while 50 were hidden and the next window still has more. The code
   therefore moves the window by 300 (`offset + 300`) and decides "more follow" by the count, never by a short page. Check: on a base
   where the person cannot read every article, request `/api/now/table/kb_knowledge?sysparm_query=workflow_state=published^kb_knowledge_base=<id>&sysparm_limit=300&sysparm_fields=sys_id`
   and count `result.length`; repeat with `sysparm_offset=300`. If the first answer is always exactly 300 until the end (the platform
   fills the window), the shortfall hint never shows and the assumption is harmless. If a window of 300 returns fewer and a later one
   still returns rows, the assumption holds and the tie-break below matters even more. What changes: nothing if it holds; if the
   platform fills windows, the "could not be read" hint can only mean an end of the list and the code is already right.

4. **Is paging stable when many articles share one "updated" time?** Assumed: no, not without a second sort key, so the list is read
   `ORDERBYDESCsys_updated_on^ORDERBYDESCsys_id`. A bulk change (a migration, a validity extension, an import) stamps hundreds of
   articles with the same second, and paging a non-unique sort can repeat or skip rows. Check: on a base where a bulk update happened,
   read three windows with and without the second key and compare the sets of `sys_id`s (console: collect them in a `Set`, report the
   size against the sum of the page lengths). What changes: if the second key is refused on this platform version (a 400), drop it from
   `readKnowledgeList` and say in the line that articles changed together may be missed.

## B. Duplicate precision

5. **Do titles alone find the duplicates a manager means?** Assumed: yes for the common case (the same article written twice, or one
   written for two audiences), because a title carries the task ("Reset your VPN password"). Not found: duplicates with different titles
   and the same body; articles that share a title on purpose (one per country, one per version). Ask: take the 10 biggest groups the tool
   shows on your base; for each, would you merge, keep both, or is it not a duplicate at all? Record the three counts. Then name two
   pairs you KNOW are duplicates and see whether any group has them. What changes: if more than a third of the groups are "keep both",
   raise the threshold default (`DUPLICATE_THRESHOLD`, 0.55) or add the category/knowledge base as a second condition for the same-title
   group; if known duplicates are missing, comparing the first paragraph (not built, and not claimed anywhere on screen) is the next
   step, and it needs the text of every article, which this tool deliberately does not read.

6. **Is "The titles share ... and are about 72% alike" a line a manager trusts?** Assumed: yes: it is the real score (word overlap and
   neighbouring-word overlap) shown as a percentage, with the shared words. The category is shown only as a plain fact beside it ("All are
   in the category VPN" / "They are in different categories"), not as a reason, because the grouping does not use it. Ask: does the
   percentage help decide, or would a manager rather see "same title" / "similar title" only? Does "different categories" make a group
   more or less suspect? What changes: the wording of `groupWhy` (`coverage.js`), nothing in the grouping.

7. **Do near-duplicates across knowledge bases matter?** Assumed: some do (the same article in the IT base and the HR base), but one
   scan stays inside one base or one category, because comparing everything with everything is quadratic and a base picker already
   exists. Ask: do you compare across bases, and how often? What changes: an "All knowledge bases" choice in the base picker (today the read
   needs a base or a category; it would need a scope of "published" alone, and the cap would hold at 1,500 for all of them together, which
   is the number to compare with the answer to question 1).

8. **Articles with no category.** Assumed: few. A scan by category never reaches them (the picker lists categories that have
   articles), and the whole-base scan reaches only the newest 1,500. Ask: how many published articles in your largest base have an empty
   category? Console: the group-by above on `kb_category`, look for the empty group. What changes: if many, the picker needs an
   "No category" entry (a count and a condition on an empty category).

## C. Gap quality

9. **Is the written-fix count the number an author wants?** Assumed: "a fix is written down" means the resolution notes are at least
   40 characters (`MIN_FIX_CHARS`, `src/knowledge/gaps.js`), and a topic shows "3 tickets, 2 with a written fix" so an author knows how much
   there is to borrow from. Ask: of the topics on your radar, open the example tickets with a "written fix"; is the fix usable, or a
   one-line "restarted, resolved"? What changes: the 40-character floor (raise it, or count only tickets whose notes are a few lines).

10. **Are the topics ones a manager would write an article for?** Assumed: tickets are grouped by shared keywords of their titles, then
    by category and by configuration item; the count is of tickets resolved in the last 30/60/90 days that have no linked article. Ask:
    take the top 10 topics; for each, is it a real gap, a topic that already has an article the link tables did not show, or noise
    (a person's name, a one-off)? Record the three counts. What changes: if "already has an article" is common, the link source is
    incomplete (see `knowledge.md` question 21: attached knowledge versus the knowledge-use log); if noise is common, the title filter
    (`STOP_TICKET`, `NOISE`) needs the organisation's own words.

11. **Is 500 tickets enough?** Assumed: for 60 days on a service desk of dozens of agents it is not, and that is why the line says "of
    12,400". Ask: how many tickets does your desk resolve in 60 days; what share does the radar read; does a category scope (the picker)
    cover the topics you care about? What changes: a higher cap (the read is one request of 500 rows; the panel groups them in memory)
    or a second page ("Look at the next 500", the same shape as the duplicate finder).

12. **Does the count of tickets include ones the manager cannot read?** Assumed (as question 2): yes, the Aggregate count ignores row
    rules, so "of 12,400" can be higher than what the person may open. The line says "Looked at 500 of 12,400", never "all 12,400".
    Check as in question 2 on `incident`. What changes: nothing in the logic; possibly one word.

## D. The surface

13. **Does the Knowledge screen open and read the same in a Workspace and on a portal page?** Built and tested in the panel's own tests
    (the screen reads through the tab only: no form, no record, no `g_form`); not seen live. Check: open the panel on a Service Operations
    Workspace list page, an Employee Center page and the classic home page, choose Knowledge, run Search, Find duplicates and Find
    topics on a small base. What changes: nothing if all three behave the same; otherwise the page shape the panel sends is wrong for
    that surface (`src/sidepanel/pageState.js`).

14. **Does "Compare the next 300" feel quick enough at 1,500 titles?** The comparison runs in the panel, every title against every
    other; on a developer machine 1,500 titles take about half a second to two seconds. Ask a manager on their own laptop. What changes:
    move the grouping to a worker, or lower the cap.
