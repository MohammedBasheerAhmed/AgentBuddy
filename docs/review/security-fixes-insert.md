# Insert and output safety: text for docs/security.md, and what other files must change

Written by the engineer who fixed AB-SEC-01, -02, -06, -07, -08, -10, -16, -17, -19, -20 and the matching integration findings (H2, M1, M2,
M7, M8, L1, L3, L8, L10, L11, L12, L16, T1). `docs/security.md` is edited by someone else: the lead merges the text below.

## A. Rows for section 4 (Controls)

Replace the "Customer-visible text" row and add the others.

| Concern | Control | Test |
|---|---|---|
| Customer-visible text | One review (`src/safeSend/review.js`) runs on text before it is put into a form field, for the field it goes into (`FILLABLE_FIELDS` in `src/lib/fillable.js` says which fields the customer or a reader can see; a field nobody described counts as visible). It stops the insert (the person can choose "Insert anyway") on personal data and secrets, on anything the firewall hid on the way out and the model brought back, on markup (a tag, `[code]`, a script link: journal fields render `[code]` as HTML), on a placeholder such as `[PERSON_1]` that was never replaced, and on 6 or more words in a row copied from an internal work note of the same record. Low-severity findings (another person's name, an IP or MAC address, "escalated to") are shown as a non-blocking "Worth a look" list. | `tests/insert-review.test.js`, `tests/insert-flow.test.js`, `tests/safesend.test.js` |
| What Insert can write | The content script accepts only the columns in `FILLABLE_FIELDS` (comments, work notes, close notes, description, short description, cause notes, workaround, the article body, the email body and subject, impact, urgency, contact type), not just any well-formed column name. A test walks the whole feature registry and fails when an insert field is missing from the list. | `tests/insert-fillable.test.js`, `tests/insert-content-fill.test.js` |
| HTML fields | The knowledge article body is an HTML field. Plain text is turned into escaped HTML (`& < > " '` escaped, a blank line is a paragraph, a line break is `<br>`) before it reaches the form, so `<img src=x>` in a model answer is shown as characters and never becomes a live tag. The page bridge also refuses to fill a field the form itself says holds HTML when no escaped text was supplied. Pages without `g_form` (Workspace, portal) receive plain text, which their own editor escapes. | `tests/insert-fillable.test.js`, `tests/insert-end-to-end.test.js`, `tests/portal-bridge.test.js` |
| Insert is bound to the record | Every FILL_FIELD carries the record the text was written for (`{ table, sysId }`, `{ table, newRecord: true }` for a blank form, or the email client of that record). The content script compares it with the form that is open at that moment and answers `wrong-record` on a mismatch; nothing is written. The panel also turns the Insert buttons off and says "This was written for INC0010001. Open that ticket again, or use Copy." when another record is open. A one-line field (a title) is replaced, never appended to. One insert at a time: a second click while one is in flight does nothing, and a button that worked says "Inserted". | `tests/insert-content-fill.test.js`, `tests/insert-flow.test.js`, `tests/insert-end-to-end.test.js` |
| Workspace insert | Without `g_form` the bridge writes only into a visible, enabled text control whose name or label is an exact match ("Description" is not "Short description"; "Work notes (internal)" is "Work notes"), refuses when two controls match equally well, never uses a password or secret-named box, and reads the value back: a box that did not take the text is a failure, not an insert. The panel says which box it used ('It went into the box labelled "Additional comments".'). | `tests/portal-bridge.test.js` |
| Rewrite and Notes obey the table policy | A rewrite or notes run carries the real table of the page the person is on and the form field the text came from, so `blockedTables`, the HR gate, `blockedFields` and the Strict-mode HR rule apply exactly as they do to an action on that record. "Use what I typed in the form" is refused on a blocked or HR table or for a blocked field, before anything is read. Text read from one record cannot be sent while another is open. | `tests/insert-compose-pack.test.js` |
| Carried drafts | A draft carried to a blank form ("Open a new article form") is kept in memory only, for the ServiceNow site it was written on, for 15 minutes; it is shown only there, only on a blank form of the named table, and is dropped when it is inserted or closed. | `tests/insert-pending.test.js` |
| Accountability | Every successful insert or copy lands in the audit log (the result card, the Write section, snippets, a carried draft), with the model that was really used and never any content. | `tests/insert-audit.test.js` |
| Stored data | Settings has a "Stored data" list of everything Agent Buddy keeps (settings, the AI key per mode, snippets, the usage log, the activity log and its salt, checklist ticks, saved dashboards) and a button "Clear everything stored by Agent Buddy" that removes every `agentbuddy_*` key in local and session storage, after a confirmation, and turns off the ServiceNow sites that were turned on. A test fails when the code uses a key the list does not describe. | `tests/insert-stored-data.test.js` |
| Checklist ticks | Kept in the browser's session storage (memory only, cleared when the browser closes), under the same salted record hash the audit log uses, encrypted with a key made from the same salt. The record's sys_id and the step hashes are never stored in the clear, and a copy of the stored data says nothing without the salt. | `tests/checks-store.test.js` |

## B. Limits for section 5

Add these.

- **The text to insert passes through an event the page can read.** When the person presses Insert, the panel sends the text (with real
  names back in) to the content script, which hands it to the page-world bridge as a `CustomEvent` on the page's document
  (`ab-page-request`). Any script that runs on the ServiceNow page (a third-party widget, a session-replay tool, a script injected through
  a vulnerable widget) can listen for that event and read the text, also when the insert then fails and the person uses Copy. The page has
  to receive the text to put it into the form, so this cannot be removed, only stated. What it exposes is the text the person is about to
  save into that form anyway, one field at a time. An HTML field is sent twice (plain text and its escaped HTML). The events carry an
  unguessable id, so a page script cannot answer a request it has not seen, but it can read any it hears; answers from the page are
  treated as data (only two shapes go back to the panel).
- **On a portal page the box is chosen by name, not by the ticket's own widget.** The bridge scores every visible text box on the page by
  its name, ng-model, label and placeholder; it never writes a customer box into a work-notes box (or the reverse), refuses when two boxes
  tie, and never presses a button. It does not know which box belongs to "the ticket" and which to another widget: a page whose only
  "Comments" box is an approval comment or a survey would receive the reply. The panel therefore says which box it used ('It went into the
  box labelled "..."') so a wrong box is easy to see before the person presses Send. Confining the choice to the ticket widget would need
  per-portal knowledge that is not available.
- **Workspace insert is unverified.** The exact-label match and the read-back are tested against a fake DOM, not a real Workspace.

## C. Section 4, "Writes to ServiceNow", one sentence to add

"Insert writes only the columns in a fixed list, only into the record the text was written for, one field at a time, and never saves."

## D. Live questions (numbered; move them to `docs/live-questions/compose.md`)

1. **Workspace control labels.** The Workspace fallback now needs the control's `aria-label` (or its `<label>`) to be the field's label
   ("Additional comments", "Work notes", "Description"), optionally followed by a marker in brackets ("Work notes (internal)"). Before it
   also accepted any label that merely contained the words. Check on a Workspace record: does Insert still find the comment box and the
   work-notes box? If the labels are different (for example "Customer comments"), change `fieldLabel` of the insert spec, not the bridge.
2. **`g_form.getGlideUIElement(name).type` of the article body.** The bridge treats a type that contains "html" as an HTML field. Check
   the type of `kb_knowledge.text` on classic and on the Knowledge workspace, and what the editor shows after Insert (paragraphs and line
   breaks should stay). If the type is something else, the field is still escaped (the name `text` is in the list), only the extra refusal
   for unlisted HTML fields would not fire.
3. **Email client address.** The panel and the content script recognise the email form of a record by `email_client.do` with
   `sysparm_table` and `sysparm_sys_id` in the address (also inside `nav_to.do?uri=`). Check that these are in the address of the form that
   opens from "Open the email form"; if the instance adds them differently, Insert into the email body answers `wrong-record` and the
   panel offers Copy.
4. **`chrome.storage.session` in the side panel.** The checklist ticks need it. It exists in Chrome 102+ and Edge for extension pages;
   without it the ticks live only as long as the panel does (an in-memory stand-in).

## E. Changes needed in files this slice does not own

1. **`src/sidepanel/useRun.js`** (panel-behaviour engineer): in `send()`, replace
   `setLastPack({ table: p.pack.table, sysId: p.pack.sysId })` with
   `setLastPack({ table: p.pack.table, sysId: p.pack.sysId, number: p.pack.number || '', internalTexts: internalTextsOf(p.pack) })`
   and `import { internalTextsOf } from '../safeSend/review.js'`. `RunPanel` already reads `run.lastPack.internalTexts` and passes it
   to the review that looks for words copied from an internal work note (AB-SEC-07); until this line is in, that one check does nothing
   for the result card. The Write section's email drafts do it themselves (they read the pack and keep the work notes). In `reset()`, also
   `setLastPack(null)` so the work notes are not kept in memory after Close.
2. **`src/sidepanel/useRun.js`** (defence in depth, pipeline engineer's `pageTable`): pass
   `pageTable: page.record?.table || page.newRecord?.table || ''` to `prepareRun`. Rewrite and Notes now put the real table in their pack,
   so the policy already applies; the extra argument covers a future caller that labels its pack with a made-up table.
3. **`src/sidepanel/App.jsx`**: `<PendingDraft page={page} eff={eff} />` (the `eff` is optional; it only adds the privacy mode to the audit entry).
4. **`src/lib/messages.js`**: the comment on `FILL_FIELD` can read `{ field, value, label, mode, expect } -> { ok, method?, label?, reason? }`.

5. **`docs/contracts.md`**, "Feature definition", the `insert` line: add "`mode: 'replace'` (optional) replaces instead of adds below; a one-line
   field (a title) is always replaced. `field` must be in `FILLABLE_FIELDS` (`src/lib/fillable.js`): a test fails when it is not. An insert goes
   only into the record the answer was written for." In "Panel sections and record tabs", `RunPanel` now remembers the record that was open when the
   run started and turns Insert off while another is open.
6. **`e2e/`** (the lead runs it; not run here): `scenarios/p-write.js` step "Replace what is in the form" then "Add below" still works (each
   button is marked "Inserted" per field and mode), and a repeat click on the same button no longer inserts twice. A portal or Workspace insert now
   says `Inserted into the form. Review it, then save the record yourself. It went into the box labelled "..."` (the first sentence is unchanged,
   so the existing text checks hold). "Insert into the email body" on the incident form still answers "That field is not on this form."; on the
   email form of ANOTHER ticket it answers "This was written for the email form of ... Open that email form, or use Copy.". A Workspace page with
   two equally good boxes now refuses (it used to take the first).

## F. Tests changed on purpose

- `tests/portal-bridge.test.js`: four assertions now also expect `label` in the answer; "the older exact-match fallback is unchanged" is
  now "an exact label still finds the box", and two equally good boxes used to mean "take the first" and now mean "write nothing".
- `tests/compose-features.test.js`: "notes to ticket can open a blank incident form" is now "no Write feature opens a form" (L1).
- `tests/checks-store.test.js`: rewritten for the session store (salted record key, encrypted list); every old behaviour is still tested.
- `tests/itsm-run.test.js` (T1): the corrupted `escapeRegex` is restored (`'\\$&'`), and two new tests prove the leak check can fail: every
  seeded value (and values with regex characters) is found when put into an outgoing request.

## G. Not done, and why

- **AB-SEC-17, dropping `scan` from the carried draft:** the draft still keeps the firewall's memory of masked values so the send check
  can recognise a secret the model repeats. It now lives 15 minutes at most, on one site, and is dropped on insert and on Close.
- **AB-SEC-20, confining the portal box to the ticket widget:** not changed (stated as a limit above); the panel names the box instead.
- **Workspace "active record container":** not available without a real Workspace; visible + exact + unique + read-back are enforced.
