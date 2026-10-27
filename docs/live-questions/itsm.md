# Live questions: ITSM record features (sentiment, next best action, thread summary, routing, article draft, major-incident updates)

Everything below was built without access to a real instance. Check each one as a user with only fulfiller roles (itil, and the
CSM/catalog roles where the kind needs them). For each: what was assumed, how to check it, what to change if it is wrong.

## Reads and columns

1. **`reopen_count` and `reassignment_count` exist and are readable on `incident`.** They are added to the incident ceiling
   (`extendFields` in `src/context/specs/itsm.js`) and only `sentiment-risk` reads them.
   Check: open an incident, Personalize List Columns (or `/api/now/table/incident?sysparm_limit=1&sysparm_fields=reopen_count,reassignment_count`).
   If a column is missing or refused, the signals say "Reopened: not stated" / "Reassigned ...: not stated" and nothing breaks.
   Change: drop the column from `extendFields` (and from `by.incident` of `sentiment-risk`) if the instance never has it.

2. **Reopen and reassignment counts exist on other kinds.** Not assumed: only the incident is extended. If cases or requested
   items carry a reopen count under another name, add it to `extendFields` for that kind and to `by` of `sentiment-risk`.

3. **`close_notesISNOTEMPTY` works for a fulfiller on incident, case and requested items** (shared with the Related tab, see
   PROGRESS question 10). The solved look-alikes of `next-best-action` and `routing-hint` depend on it. If the condition is ignored
   the search returns unsolved tickets; `findSimilarTickets` then drops hits without close notes, so the effect is fewer hits, not wrong ones.

4. **The new read `routingLookalikes` (`src/content/ops/itsm.js`)**: one extra GET on the same table, `sys_idIN<up to 5 ids>`, asking for
   `assignment_group`, `priority`, `subcategory`. Assumes those columns are readable on look-alike tickets (they are ordinary task
   columns). `sc_request` has no `assignment_group`, so for requests the group is blank and the routing hint says "Not enough information".
   Check: run "Where should this go?" on a request and on an incident; read the preview and confirm the reference tickets show their group.

5. **`kb_knowledge` can be searched with `workflow_state=published` and `textLIKE`, and `text` can be read, by a fulfiller** (PROGRESS
   question 7). Also: does the Table API hide articles the person's *user criteria* would hide in the Knowledge portal? Compare the
   hits for one ticket with a search in the Knowledge portal for the same words. If articles that the portal hides are returned,
   the "similar article exists" line could name an article the agent cannot open; tighten in `searchKnowledge`, which belongs to the context area.

6. **"Strong match" threshold.** An article is a strong match when its score is at least 60 and the match is in the title
   (`STRONG_SCORE` in `src/itsm/reference.js`; score = 2 points per search word in the title, 1 per word in the text, as a percentage).
   Check with about ten real resolved tickets whose article exists: the line "Similar article exists" should appear for true duplicates and
   not for loosely related articles. Change: the constant, or require two title words.

## Notes, people and time

7. **Who is the customer.** The customer is the person in `caller_id`, `requested_for`, `contact` or `consumer`; a customer-visible comment
   by anyone else counts as support. `opened_by` is not used (an agent often opens a ticket for a caller).
   The author of a note is matched by display name, by the front of the email address, or by a login written like `abel.tuter`.
   Check: a ticket opened through the portal and one answered by email. Is the author shown as the caller's name, as a login such as
   `guest`, or as a system user? Comments by `guest` or a system account would be counted as support, and the signals would undercount
   the customer. Change: add those logins to `roleOfEntry` in `src/itsm/sentiment.js`, or read `sys_user.user_name` into `people[].login`.

8. **Time zone of note times.** When notes come from the record's `comments` / `work_notes` display strings, their times are in the reader's
   time zone and format (see `src/context/journal.js`); from `sys_journal_field` they are UTC. "Time since the customer's last message"
   compares them with the computer's clock as if they were UTC, so it can be off by the person's UTC offset. The wording says
   "about" and "approximate" for that reason, and a time in a format we cannot read gives "not known". Check: compare the figure with
   a note you know the age of, on a user whose time zone differs from UTC. Change: pass the user's UTC offset (from `getUserInfo`) into `computeSignals`.

9. **English word lists.** Frustration, escalation, urgency, repeat and chasing words are English only
   (`src/itsm/sentiment.js`). A thread in another language gets few signals; the model still reads the thread itself. Add word lists per language if needed.

10. **VIP / executive flag.** The plan mentions "VIP/executive tone". `sys_user.vip` is not read (the people lookup asks only for
    name and email). If wanted, the people lookup in `src/context/people.js` would have to read `vip` and put it on `people[]`.

## Article draft and Insert

11. **The article form's field names and the body editor.** `short_description` and `text` are the columns of `kb_knowledge`. Check on the
    classic form (`kb_knowledge.do?sys_id=-1`) and in the Knowledge workspace: does Insert body keep the line breaks? `text` is an HTML
    field, and plain text with newlines may show as one run-on paragraph. Change: in `pickArticleBody` (`src/itsm/sections.js`) turn line
    breaks into `<br>` / `<p>`, or add an HTML-aware fill to the page bridge (the lead's file). The labels `Short description` and `Article body`
    (`fieldLabel` of the inserts) are guesses for the Workspace aria-labels.

12. **Insert buttons act on whichever form is open.** The two article inserts carry `table: 'kb_knowledge'`. Until ResultView refuses an
    insert when the open form is not that table, pressing "Insert title" while still on the incident would append the title to the
    incident's short description (not saved; the person presses Save). Also check that the result survives "Open a new article form"
    (the tab navigates away). See the report for the change asked of ResultView.

13. **The new-article address.** `open: { table: 'kb_knowledge' }` opens `kb_knowledge.do?sys_id=-1` through `nav_to.do`. In Knowledge
    Management v3 / the Knowledge workspace the authoring form may be elsewhere. Check what the link opens for a user with `knowledge` role.

## Major-incident updates

14. **Linked child incidents.** A major incident's children are normally linked by `parent_incident`, not by `parent` (the task parent that
    `childTasks` reads). `src/context/related.js` does not read `parent_incident`, so the update sees the incident's own tasks and SLAs but not
    the count of linked incidents. Check: a major incident with linked incidents; does "Child tasks" list them? If not, a `childIncidents`
    source (`incident` where `parent_incident=<id>`) would have to be added to `related.js` by its owner, and `major-incident-comms` added to its use.

15. **Priority wording.** Routing suggests a priority exactly as a look-alike shows it (for example `2 - High`). Check the format matches what the
    priority choice list shows on the form; if the instance shows only `High`, the text is still understandable.

## Not checked at all

- A real model's behaviour with these prompts: the output structure (four lines, `- [ ]` steps, labelled sections, the first line about a similar
  article, `[time]`) is asked for in the prompt and tested only with scripted replies. Run each feature a few times on real tickets, with the
  preview on, and read both the outgoing text and the answer.
- Whether a person named only in a sentence of another ticket's notes reaches the AI (known limit, shown in the preview). Reference material
  from other tickets is the main place this can happen.
