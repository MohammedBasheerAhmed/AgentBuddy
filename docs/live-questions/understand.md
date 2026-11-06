# Understand the ticket (round 4): what was assumed and how to check it

Area: "Since you last looked" and "The caller wrote" as the first facts of "Understand the ticket" (`src/insights/sinceLooked.js`,
`src/sidepanel/ticket/{useNeeds,needsNow,focusView}.js`, `TicketInsights.jsx`), the time kept per ticket (`src/lib/lastViewed.js`, policy
`rememberLastViewed`), and the AI action "Translate the caller's message" (`src/features/packs/translate.js`). Built and tested with unit
tests and the small DOM (`tests/understand-*.test.js`); none of it has met a real ServiceNow instance. Each question says what was
assumed, how to check it with fulfiller roles only, and what to change if it is different.

## A. Since you last looked

1. **Is the "last looked" time the time the panel showed the ticket, and is that close enough to "when the agent last looked"?**
   Assumed: yes. The time is written when the Ticket screen shows a record (the panel open on that ticket), not when the ServiceNow form
   is opened with the panel closed. An agent who works the ticket with the panel closed gets an older time (more shown as new).
   Check: open a ticket with the panel open, close the panel, add a comment as the caller (or ask a colleague), open the ticket again
   with the panel: "Since you last looked (today hh:mm)" names the first visit and "1 message from the caller".
   If wrong: also write the time from the content script's record detection (a new message to the worker), still sys_id, table, time.

2. **The agent's own changes show as "since you looked".**
   Assumed: acceptable. A reply or a state change the agent made after opening the ticket is counted the next time ("1 reply to the
   caller", "moved to In Progress"): the field history read does not say who made a change, and the journal author is compared with
   the caller only.
   Check: open a ticket, reply as the agent, open another ticket, come back: is "1 reply to the caller" confusing in practice?
   If wrong: leave out journal entries whose author is the signed-in user (`page.user.name`), and read `sys_created_by` with the field
   history (`readFieldHistory` in `src/content/ops/insights.js`) to leave out the agent's own changes.

3. **Is `sys_audit` readable for a fulfiller?** (the field history: state, group, priority changes)
   Assumed: often not (admin-only on many instances). Then the fact says "state and group changes not readable" and never claims "not
   reassigned" or a state change; "Nothing new" then rests on the record's `sys_updated_on` (stored time) alone.
   Check: as a fulfiller, open the Ticket journey card: does it show the path between groups, or "The field history is not readable"?
   If wrong (readable): nothing to change. If readable only in part (some tables): the journey read already reports it per record.

4. **Does `sys_updated_on` move with every change, a comment included?**
   Assumed: yes (a journal entry updates the parent record). "Nothing new since you looked" is said when the stored update time is not
   after the last visit.
   Check: add a comment on a ticket and compare its `sys_updated_on` before and after (list view, the column "Updated").
   If wrong: say "No new messages since you looked" unless the field history was read.

5. **Note times read from the record's own text (when `sys_journal_field` is not readable) are in the reader's time zone.**
   Assumed: they are put on UTC with the offset of the record's dates (`noteInstant`, `src/insights/time.js`), as the Glance does; a
   note near a clock change may be counted on the wrong side of the last visit by up to an hour.
   Check: a user without `sys_journal_field` read access, a comment written just before and just after the last visit.
   If wrong: leave out notes within an hour of the last visit when their time is approximate.

6. **Only the newest 30 notes and comments are read.**
   Assumed: enough. More than 30 entries since the last visit are counted as 30 (the journal read says "Showing the newest 30").
   Check: a ticket with a long conversation since the last visit.
   If wrong: say "30 or more" when the journal access entry has `more: true`.

## B. The caller wrote

7. **Is the caller the author of a comment when the author name matches a customer role (caller, requested for, contact, consumer,
   opened for, subject person)?**
   Assumed: yes, by name, email or login key (`src/context/identity.js`). A comment that arrives by email from another address of the
   caller, or under a login that is not their email, is not "the caller" (the fact is then about an older message, or not shown).
   Check: a ticket the caller updated from the portal, and one updated by email reply.
   If wrong: also match `sys_created_by` against the caller's `user_name` (it would need the user name on the people list).

8. **Is the comment text shown as written?**
   Assumed: the text of the comment as the panel reads it, without the quoted mail thread and the signature (`cleanEmailText`, as every
   AI part); HTML is already turned into text by the reader. Nothing is stored.
   Check: a caller's email reply with a long quoted thread: only the new part shows; nothing of the earlier thread.

## C. Translate

9. **Is "another script than the panel's language" the right trigger?**
   Assumed: yes for the agents asked about (Arabic and English): an Arabic message with an English panel, a Latin message with an Arabic
   panel, any other script (Cyrillic, CJK...). A French or Spanish message with an English panel is the same script: no button (the action
   is still in AI Assist and All tools).
   Check: with the agents: do they want the button for other Latin-script languages too?
   If wrong: detect the language (a small word list) instead of the script.

10. **Does the launch from Insights reach AI Assist in every browser?**
    Assumed: yes. "Translate" leaves the same request the bar on the ServiceNow page leaves (`chrome.storage.session`, `LAUNCH_KEY`),
    which the panel takes once (`useLaunch`), and the Ticket screen runs it as a click in AI Assist (preview first). Tested in the small DOM
    and through `TicketView`; not in a real Chrome, Edge or Firefox panel.
    Check: Chrome, Edge and Firefox: an Arabic comment from the caller, English panel, "Understand the ticket" > "Translate": AI Assist comes
    forward with the check before sending.
    If wrong: give TicketInsights an `onLaunch(featureId)` prop from TicketView (the same handler as a launch) instead of storage.

11. **Is "the panel's language" the right target when the setting "Language of AI answers" says "The language of the ticket"?**
    Assumed: yes: the action exists to read the caller in the agent's own language, so its fixed prompt names the panel's language (said
    last in the prompt, "this replaces any earlier instruction about the language"). With "The language of the panel" the pipeline adds
    the same language once more.
    Check: with the agents.
