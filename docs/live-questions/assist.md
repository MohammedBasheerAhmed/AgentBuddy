# Live questions: AI Assist actions, the quick bar and Insert (round 3)

Written by the Actions agent (TRACKER.md AI1-AI22, F5, F6). Nothing here has run against a real instance: the unit tests use fake
forms and the end-to-end suite a fake ServiceNow. Check each on dev364920 as a fulfiller (`itil`, no admin). Each question says what
was assumed, how to check it, and what to change if it is wrong.

## The ticket's stage, from its state (src/features/stages.js)

1. **State display values.** The stage is worked out from the DISPLAY value of `state` in the header read ("In Progress", "Closed
   Complete"), matched in English. Assumed base-system values: incident New / In Progress / On Hold / Resolved / Closed / Canceled;
   problem New / Assess / Root Cause Analysis / Fix in Progress / Resolved / Closed; change New / Assess / Authorize / Scheduled /
   Implement / Review / Closed / Canceled; catalog task and requested item Pending / Open / Work in Progress / Closed Complete /
   Closed Incomplete / Closed Skipped; case New / Open / Awaiting Info / Resolved / Closed / Cancelled; HR case Draft / Ready /
   Awaiting Acceptance / Work in Progress / Suspended / Closed Complete / Cancelled. Check: open one record of each kind in each state
   and look at the AI Assist heading ("Suggested for a new ticket", "...while you work on it", "...for wrapping up", "...for a closed
   ticket"). If an instance uses another language or renamed states, the heading says just "Suggested" and nothing is hidden; add the
   words to the lists in stages.js (or read the state's VALUE as well, which needs the header read to return it).
2. **"Open" is working, "Pending" is new.** A catalog task or requested item in "Open" is treated as being worked (reply, next steps),
   one in "Pending" as not started (understand it first). Check with a fulfiller whether "Open" tasks are usually untouched; if so
   move `open` to the NEW list.
3. **Change "Review" is wrap-up.** A change in Review gets the Resolve suggestions (and the CAB brief stays under More). Check with a
   change manager that this is the moment they write up the change.

## Which actions show (AI1-AI22)

4. **Major incident (AI15).** "Draft major incident updates" shows on an incident whose `major_incident_state` is Proposed or
   Accepted. The header read (src/content/index.js `header`, Foundation agent) reads only number, short description, state and
   priority today, so until it also reads `major_incident_state` the rule falls back to priority 1 ("1 - Critical"). Check: (a) does
   the instance have the Major Incident Management plugin, and can an `itil` user read `incident.major_incident_state`; (b) do the
   display values read "Proposed" / "Accepted" / "Rejected" / "Canceled"? If yes, ask the Foundation agent to add the column to the
   header read; a header that carries it EMPTY means "not a major incident" whatever the priority.
5. **Tasks of a problem or a change have no customer (AI7).** "Draft a reply" and "Ask the customer for missing details" are not
   offered on `change_task` and `problem_task`. Other task tables (`incident_task`, `sn_customerservice_task`) keep them with a
   caution that the customer may not see task comments. Check on a real incident task who receives its comments (watch list? the
   parent's caller?).
6. **Catalog task comments (AI7, AI6).** Assumed: the requester does not see comments on an `sc_task`; they read the requested item.
   The actions warn about it and the Insert says where the text lands. Check in the Service Portal / Employee Center as the requester:
   is a comment posted on a catalog task visible on the request page? If it is, drop the caution in stages.js `cautionFor` and
   fillable.js `describeInsert`.
7. **"Draft a checklist from the instructions" (AI18)** shows only when the task's written instructions (`description`,
   `special_instructions`) give no steps by the no-AI splitter. Check on real catalog tasks how often the instructions are a list
   (then the action rightly stays hidden) and how often they are prose.

## Insert into the form (F5): src/lib/fillable.js, src/sidepanel/insertFlow.js, src/content/fill.js, src/page/bridge.js

8. **Which box per kind.** Assumed labels and columns: incident and case resolution notes are `close_notes` labelled "Resolution
   notes"; requested item, catalog task and other tasks `close_notes` labelled "Close notes"; a problem has no `close_notes` on its
   form and keeps the fix in `fix_notes` ("Fix notes") and the cause in `cause_notes` ("Cause notes"). Check each form (classic and
   Workspace): is the field there, and is the label as assumed? The label matters on a Workspace, where the box is found by its label.
   Wrong label: change `fieldLabel` in src/features/packs/core.js (resolution-notes) and checks.js (resolution-improve).
9. **The check before the click (getEditableFields).** On a classic form the panel asks `g_form.hasField` and
   `g_form.getEditableFields()` before it offers Insert; a field that is missing or not editable gets "...is not on this form" /
   "...cannot be changed on this form right now. Use Copy." Check: on a resolved incident whose Resolution notes are read-only by
   UI policy, does `getEditableFields()` leave `close_notes` out? On a Workspace or portal page the box is searched for (as an insert
   would) and a box that is not found is "unknown", never "missing" (it may sit on a tab that is not open). Check on a Workspace record
   with the Resolution notes on a closed tab: Insert stays on and then fails with "Agent Buddy could not reach a form field", which
   falls back to Copy.
10. **Workspace composer.** Assumed: the Service Operations Workspace activity composer is one box with a switch between "Work notes"
   and "Additional comments (Customer visible)", and its label follows the switch. The panel says before the click: "check it is set
   to Work notes / Additional comments before you post", and after it: "Then press Post." Check: (a) what is the box's aria-label in
   each position of the switch? (b) does the bridge find it by "Work notes" / "Additional comments"? (c) if the label does NOT follow
   the switch, a work note could land in a customer-visible post: then the Workspace path must refuse journal inserts unless the label
   names the right kind (src/page/bridge.js chooseWorkspaceControl).
11. **Saving a comment emails the customer.** The note after a comment insert says "Saving sends the comment to the customer."
   Assumed: the base notification "Comment left on incident" (and its siblings) is on. Check one: insert, save, and look at the
   caller's sys_email.
12. **No second copy after "Try again".** The panel remembers (in memory only) what it put into a box; the next insert of the SAME
   action into the SAME box, in the box's usual mode, swaps that text for the new one when the box still holds it as a whole block
   (from the start of a line to the end of a line). Check on classic, Workspace and a portal: insert a hand-off brief into the work
   notes, Try again, insert again: one brief, below anything typed before. A journal box that a Workspace re-renders after each
   keystroke may not keep the text exactly; then the new text goes below (the old behaviour).
13. **Resolution notes replace.** Resolution notes and "Improve my resolution notes" REPLACE the box by default (the person can pick
   "Add below" on the answer card). Check with agents that nobody keeps a template or a checklist in the Resolution notes box that
   this would wipe; if they do, make "Add below" the default for `resolution-notes` (keep Replace for `resolution-improve`).

## The quick bar (F6)

14. **The Insights cards it opens.** The bar offers "Ready to resolve?" (card id `ready`, N4) and "Related tickets" (`related`, N2)
   when the Insights half has a card with that id for the record. Assumed ids; the Insights agent owns them.
15. **The bar on the ServiceNow page** (src/background/bar.js) still asks `quickActions({ kind, pins, policy })` without a state, so
   it shows the kind's defaults. It can pass `stage` (and `aiOn: false` when the organisation switched AI off) for state-aware
   defaults; Insights items never go to the page bar.

## An AI email draft into the email form (AI9): AnswerCard.jsx, pendingDraft.js, PendingDraft.jsx

16. **The email client as a tab of its own.** "Open the email form" on an email answer opens `email_client.do?sysparm_table=...&
   sysparm_sys_id=...` (`emailFormUrl`) in a NEW tab next to the ticket, as the Insights email card does; the panel follows that tab
   and shows the carried draft only when the address names the same table and sys_id (`emailClientTarget`). On the classic UI the
   client usually opens from the form's menu as a popup. Check as `itil` on an incident, a requested item and a case: does the client
   work as a full tab, and does its address keep both parameters (also after it reloads itself)? If the address loses them the draft
   card never appears (Copy body still works); then bind the draft by another stable part of the address.
17. **Insert subject / Insert body.** Assumed: `FILL_FIELD` reaches `subject` (one line, replaced) and `body` (added below what the
   client put there) through `g_form`, or the bridge's DOM search by name or by the labels "Subject" / "Body". The real client may
   keep the body in a rich-text editor (an iframe the bridge does not search): then Insert body answers "could not reach a form
   field" and copies the body instead, which the card says. Check: draft, open the form, press both. If the body never goes in, give
   the bridge a rule for that editor (src/page/bridge.js) or drop Insert body and keep Copy body.
18. **Replacing the subject.** The client pre-fills a subject (often with the ticket number). Insert subject REPLACES it with the
   draft's subject, which has no number unless the model kept it. Assumed: replies still reach the ticket through the watermark in the
   body (the body insert adds below, so the watermark stays). Check with one reply from a test mailbox. If replies match on the number
   in the subject instead, keep the client's subject and put the draft's after it (`emailInserts` in src/sidepanel/pendingDraft.js).
