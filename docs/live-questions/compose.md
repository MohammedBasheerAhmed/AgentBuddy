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
3. **The draft's subject.** Not inserted at all (only copied): the client pre-fills a subject from its template and the control
   name is unknown. If the subject field has a stable name, add a second `FILL_FIELD` call in `EmailPanel.jsx`.
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
