# Live questions: the Write section (email, rewrite, notes to ticket, snippets)

Nothing here could be checked against a real instance. Each item says what the code assumes, how to check it as a non-admin
fulfiller, and what to change if the assumption is wrong. The code fails soft in every case: the worst outcome is "Copy
instead of Insert" or a less specific email suggestion, never a wrong write.

## Email

1. **The classic email client address.** Assumed: `/email_client.do?sysparm_table=<table>&sysparm_sys_id=<id>&sysparm_target=<table>&sysparm_uniqueValue=<id>`
   opens the email composer for the record as a full page in the same tab (`emailFormUrl` in `src/compose/emailRecommend.js`).
   Check: press "Open the email form" on an incident, a request item and a case, on the classic UI and from a Workspace record.
   If it opens a blank or wrong page, or leaves Workspace in a way that loses the record, change the URL there (one function);
   on Workspace the right answer may be to hide the button and offer Copy only.
2. **Insert into the email body.** Assumed: when the email form is open on the page, `FILL_FIELD` with field `body` / label `Body`
   (append) finds an editable control, either through `g_form` or the bridge's DOM search (`name`, `id`, `data-field-name` equal
   to `body`, or an aria-label containing "Body"). The classic email client may use a rich-text editor (an iframe) or a dialog
   inside an iframe; the bridge only searches the top document and open shadow roots, so Insert may always answer "no form" and
   fall back to Copy. Check: draft, open the form, press "Insert into the email body". If it never works, either give the
   bridge a rule for the editor (`src/page/bridge.js`, not owned by this area) or remove the button and keep Copy body.
3. **The draft's subject.** Since round 3 the Ticket screen's email drafts are carried to the email form and offer "Insert
   subject" (replace) and "Insert body" (append) there (`src/sidepanel/PendingDraft.jsx`, AI9). The subject keeps the ticket
   number in front ("INC0010001: ...", `subjectWithNumber` in `pendingDraft.js`), because the client's own subject carried it.
   Check: is the subject control called `subject` (g_form or DOM), and does a customer's reply to such an email still land on the
   ticket (watermark in the body, or the number in the subject)? See also `assist.md` questions 16 to 18.
4. **Words on the record.** The suggestions read English display values: states ("On Hold", "Resolved", "Closed Complete",
   "Canceled", "Awaiting Info"), hold reasons ("Awaiting Caller", "Awaiting User Info"), approval states ("Requested",
   "Rejected") and SLA stages ("In progress", "Completed", "Cancelled"). Check on the instance, including a non-English or
   customised one: if the labels differ the rules simply do not fire and the panel falls back to a plain status update. Fix by
   extending the regular expressions in `readSignals` / `approvalState` / `slaState`. Also check the CSM case and HR case state
   labels (not seen).
5. **Who wrote the last comment.** Assumed: a comment's `by` is a display name (`applyAuthorNames`) that equals the caller's
   name from `people`, so the direction (customer or service desk) can be told. If the journal table is unreadable and the
   record's own comment fields are used, `by` is the name in the header line; if `by` is only a login the code compares it with
   the start of the caller's email address and otherwise says "unknown" (no guessing). Check on a ticket where the caller
   commented from the portal: does the panel say "They wrote ..."? If not, see what `by` holds and adjust `lastMessage`.
6. **Age of the last comment.** From `when`. `sys_journal_field` gives UTC; the record-field fallback gives the reader's time
   zone (see the journal notes in `src/context/journal.js`). Ages are only compared to thresholds of 1, 2, 3 and 14 days, so a
   few hours of offset rarely changes a suggestion; confirm on a ticket with a recent comment that the age shown is believable.
7. **Approvals and SLAs on the pack.** Assumed readable by a fulfiller: `sysapproval_approver` (state, approver, `sys_updated_on`
   as the "waiting since" time) and `task_sla` (`has_breached`, `business_percentage`). A denied read just removes that signal
   (the pack's `access` says so). The "waiting since" age uses the approval row's last update, which may be later than the
   request time if the row was edited; check against a known old approval.
8. **Columns on the 'email-compose' spec.** `hold_reason`, `approval`, `due_date`, `closed_at`, `resolution_code`, `start_date`,
   `end_date` and the `WHO` columns are intersected with each kind's ceiling, so a column a kind lacks is just absent. Confirm the
   case table (`sn_customerservice_case`) and `sc_req_item` really answer for `contact` / `consumer` / `approval` / `due_date`.
   `assigned_to`, `opened_by` and `requested_by` are read only so the firewall knows those people by name (a name can sit inside
   a description or a comment); the drafts leave them out of the parts. Check on a non-admin account that the people list of a
   pack then holds the assignee and the opener, with names.
9. **HR cases.** The drafts follow the existing rule: blocked unless the organisation allows HR content, and free text and
   identities are read only then. Not exercised against a real HR table.

## Rewrite

10. **Reading what was typed in the form.** The `formValues` operation asks the page bridge for `comments`, `work_notes`,
    `close_notes`, `description`, `short_description`. On the classic form `g_form.getValue('comments')` should return the
    unsaved text. On Workspace and portal pages there is no `g_form`, the bridge answers `null` and the panel says "paste the
    text instead". Check both. A DOM fallback for reading (like the one for writing) would have to be added to
    `src/page/bridge.js` (not owned by this area).
11. **Replace vs append.** Replace is `g_form.setValue(field, text)`; on Workspace the DOM fallback matches the control by
    aria-label ("Additional comments", "Work notes", "Resolution notes", "Description", "Short description"). Those labels are
    the ones used by the existing Insert buttons; check "Resolution notes" and "Short description" on a Workspace form, they are
    new in this area.
12. **Names in the text.** Names are masked precisely only for the open record's people and for names typed under "Names to
    hide". A name only written in the pasted text is not found (documented firewall limit); the preview shows what is sent.
    Check with a text that mentions a colleague.

## Notes to ticket

13. **Blank form detection.** `page.newRecord` comes from `g_form.isNewRecord()` on the classic UI. Check that a new incident
    opened from the navigator (`/incident.do?sys_id=-1`) and from `nav_to.do?uri=incident.do?sys_id=-1` (the "Open a new incident
    form" button) both set it, and that a new case form (CSM) does. Workspace "new" forms are not detected (Fill is off there; Copy
    works).
14. **Choice values.** Assumed base-system values: impact and urgency `1` High, `2` Medium, `3` Low; `contact_type` `phone`,
    `self-service`, `email`, `walk-in`. Instances change these lists. Check the Channel list on the incident form (hover or
    inspect the options) and edit `LEVELS` / `CONTACT_TYPES` in `src/compose/notesToTicket.js` if they differ. The channel is only
    filled on the `incident` table; a case form keeps its own list and is not filled.
15. **Fields that are not on the form.** A form without impact, urgency or channel answers "that field is not on this form"; the
    panel reports it per field and still fills the rest. Check on a case form, which has priority instead of impact/urgency.
16. **Existing text.** Before filling, the panel reads `short_description` and `description` through `formValues` and asks before
    replacing text the agent already typed. Check that the read works on a blank form (it should return empty strings).

## Snippets

17. **Reading the pack for the preview.** Uses the 'reply-draft' spec as asked, which also reads notes, SLAs, approvals and
    variables (about eight GETs for one preview). Check the time on a busy ticket; if it is slow, add a smaller spec (only the
    caller, number, state, priority, assignee and SLAs) and read that instead.
18. **`sla.due`.** Taken from the earliest open SLA row's `plannedEnd` (`src/context/related.js` shapes it that way; the
    template engine used to look for `due`, which the real pack never has, and now understands both). `plannedEnd` is in the
    reader's date format. Check one ticket with an SLA: does `{{sla.due}}` show the expected time? If the format needs to be
    friendlier, format it in `buildVariables`.
19. **Safe-to-send on snippets.** The check flags phrases such as "work note" or "escalated to" and any email that is not one of
    the record's people. A snippet that mentions a team mailbox will warn every time; the person can insert anyway. If this is
    noisy, the phrase list can be passed per snippet kind.
20. **Storage.** Snippets are saved under `agentbuddy_snippets` in `chrome.storage.local` (500 snippets of 8000 characters is at
    most 4 MB, under the 10 MB quota). Check that two panels (two windows) see each other's changes.

## Insert safety (moved here from `docs/review/security-fixes-insert.md`)

21. **Workspace control labels.** The Workspace fallback needs the control's `aria-label` (or its `<label>`) to be the field's label
    ("Additional comments", "Work notes", "Description"), optionally followed by a marker in brackets ("Work notes (internal)"). Before
    it also accepted any label that merely contained the words. Check on a Workspace record: does Insert still find the comment box and
    the work-notes box? If the labels are different (for example "Customer comments"), change `fieldLabel` of the insert spec, not the bridge.
22. **`g_form.getGlideUIElement(name).type` of the article body.** The bridge treats a type that contains "html" as an HTML field. Check
    the type of `kb_knowledge.text` on classic and on the Knowledge workspace, and what the editor shows after Insert (paragraphs and
    line breaks should stay). If the type is something else, the field is still escaped (the name `text` is in the list), only the extra
    refusal for unlisted HTML fields would not fire.
23. **Email client address.** The panel and the content script recognise the email form of a record by `email_client.do` with
    `sysparm_table` and `sysparm_sys_id` in the address (also inside `nav_to.do?uri=`). Check that these are in the address of the form
    that opens from "Open the email form"; if the instance adds them differently, Insert into the email body answers `wrong-record` and
    the panel offers Copy.
24. **`chrome.storage.session` in the side panel.** The checklist ticks need it. It exists in Chrome 102+ and Edge for extension
    pages; without it the ticks live only as long as the panel does (an in-memory stand-in).

## Added 2026-10-30 (features walk)

25. **Snippets are filled from their own context spec, `snippet-fill`** (`src/context/specs/compose.js`): number, short description,
    state, priority, the people and the SLAs, no notes, no description. The Snippets panel still reads the pack with `reply-draft`, which
    has no `priority`, so `{{priority}}` was always "The record has no value for this", and ten notes were read for nothing. Needs one
    line in `src/sidepanel/compose/SnippetsPanel.jsx` (not this area's file): `feature: SNIPPET_FEATURE` (from `src/snippets/preview.js`)
    instead of `'reply-draft'`. Check after that change: `{{priority}}` and `{{sla.due}}` fill on an incident and a requested item.
26. **A consumer is the caller of a snippet.** `{{caller.first_name}}` on a customer service case with a private customer (consumer,
    `csm_consumer`) was empty; the role `consumer` now counts after `contact`. Check on a B2C case.
27. **The email suggestion compares times on one clock.** Note times read from `sys_journal_field` are stored UTC; field values are
    display values in the reader's time zone. "Was the person told after it was resolved?" compared the two, so it was wrong by the
    reader's UTC offset (an answer sent 30 minutes after resolving counted as "not told" at UTC+2). The `email-compose` pack now carries
    the stored UTC values of `opened_at`, `resolved_at` and `closed_at` in `related.times` (spec key `times`), and the suggestion uses
    them unless the notes came from the record's own fields (then both sides are local). Check: an incident resolved a few minutes
    before the agent's last comment, with the user's time zone far from UTC; the suggestion says the person was already told.

## Added 2026-10-30 (round 3: the Write screen)

28. **"Check my comment" reads the unsaved comment through the page bridge** (`getFormMeta`, then `getFormValues` for `comments`,
    `close_notes` or `description`; classic forms only, through the frame `gsft_main` as for Rewrite). It first checks that the open form
    is the panel's record (`expect` in the `formValues` READ); another form answers "not the ticket open here". On a Workspace or a portal
    there is no `g_form`, so the panel offers to check pasted text. Check on dev364920: type a comment on an incident (do not post it), press
    "Check my comment"; the text it checks is what you typed. In Next Experience (classic form inside the unified navigation) the same.
29. **The record's notes for the work-note overlap** are read with the new `send-check` spec (people and journal, no other columns). The
    journal is the usual `sys_journal_field` read. Check that a fulfiller's journal read returns the work notes (it does for Rewrite and
    the drafts already).
30. **Organisation snippets come from the managed policy `orgSnippets`** and are never stored by the panel. Check with a managed policy in
    Chrome/Edge (`chrome://policy`) that the list shows marked "From your organisation" and cannot be edited.
31. **A snippet file** is saved with an `<a download>` on a `blob:` address from the side panel (no `downloads` permission). Check in
    Chrome and Edge that the file lands in the downloads folder without a prompt that the panel cannot answer; if the browser asks where
    to save, that is fine. The file input accepts `.json`; a file the browser names `application/octet-stream` is refused (rename it).
32. **Snippet targets** are offered per kind of record (`src/snippets/targets.js`): incident and case: comments, work notes, resolution
    notes, description; problem: also cause notes and workaround; the email form: body. A field that is not on the form answers "That field
    is not on this form" and the text is copied instead. Check `cause_notes` and `workaround` on a problem form and `close_notes` on a case
    (CSM forms may call it "Resolution notes" under another column).
33. **Notes to ticket: "Open a blank incident / case"** navigates the same tab to `nav_to.do?uri=incident.do?sys_id=-1` (or
    `sn_customerservice_case.do?sys_id=-1`), the classic form. Agents on Service Operations Workspace may prefer a new Workspace record
    tab; the classic form is used because Fill needs `g_form`. Check that the blank case form opens for a CSM agent (some instances
    restrict creating cases from the classic UI) and that the panel picks it up as a blank form (`page.newRecord`).
34. **Suggestions for caller, category and group** (`src/compose/notesHints.js`, no AI): look-alikes are resolved tickets of the same table
    whose `short_description` is LIKE one of up to four words of the proposed one (30 newest), voting on `category` (choice value) and
    `assignment_group`; callers are active `sys_user` rows whose `name` is exactly a name typed under "Names to hide". Check: (a) a
    fulfiller can read `sys_user.email` and `department` (field ACLs may blank them; the line then shows the name only); (b) `name=` with a
    space in the value works in `sysparm_query` (it is URL-encoded by the Table API client); (c) category display values come back with
    `sysparm_display_value=all`. Nothing is filled: caller, category and group are not in `FILLABLE_FIELDS`.
