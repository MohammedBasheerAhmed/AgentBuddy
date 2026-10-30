# Live questions: knowledge articles and chat (C5, C6, C7, D1, D2)

None of this could be checked against a real instance. Each question says what the code assumes, how to check it as a user with
only fulfiller roles (no admin), and what to change when the assumption is wrong. Everything degrades into an `access` note
(shown in the panel) instead of an error, so a wrong guess hides a feature but never shows wrong data.

Where to look: `src/context/chat.js` (chat), `src/context/knowledge.js` (articles, tickets, links), `src/context/specs/knowledge.js`
(columns), `src/context/pack.js` (per-kind extras).

## Chat (D1, D2)

1. **Which tables hold the messages.** Assumed: Agent Workspace / Advanced Work Assignment / Virtual Agent chat keeps messages in
   `sys_cs_message` (conversation in `sys_cs_conversation`); Connect Support keeps them in `live_message` (conversation in
   `live_group_profile`). Check: open a chat interaction as a fulfiller, then browse `/sys_cs_message_list.do`,
   `/live_message_list.do` (or `/api/now/table/sys_cs_message?sysparm_limit=1`). Wrong: edit `OWN_MESSAGES`, `HOLDERS` and `DIRECT` in
   `src/context/chat.js` (one line per table).
2. **Can a fulfiller read them at all?** Assumed: yes for the chats they handled, via ACLs on those tables. Check: the same
   requests as non-admin; note 403 (denied) versus 200 with no rows (hidden). The panel says "No chat messages are available to
   you" in both cases and the `access` entry names the table and status. Wrong (always denied): the Chat tab still shows the facts of the
   interaction record; nothing to change in code, but the feature description should say it needs read access to the chat tables.
3. **How a conversation points back at the record on screen.** Assumed, tried in this order: `sys_cs_conversation.interaction`,
   `sys_cs_conversation.document_id`, `live_group_profile.document`, `live_group_profile.interaction`, and as a last resort
   `sys_cs_message.interaction`. Check: open one `sys_cs_conversation` / `live_group_profile` row and look at its reference columns.
   Wrong: change the `links` arrays in `HOLDERS` / the `DIRECT` link. A column that does not exist is detected (the instance
   answers with every row; every row is checked against the id that was asked for) and reported, never used.
4. **The text of a message.** Assumed: one of `message`, `text`, `body`, `value`, `formatted_message` (HTML is stripped) or a JSON
   `payload` that holds the text under `value` / `text` / `message` / `body`. Check: a row of the message table. Wrong: add the
   column to `MESSAGE_FIELDS` and `TEXT_COLUMNS`.
5. **Who sent it.** Assumed: a name column (`sender`, `author`, `profile`, `user`, display value) or, failing that,
   `sys_created_by` (a login, turned into a name through `sys_user`). Check: does a message row name the sender, and is it a
   `sys_user` or a `live_profile`? Wrong: edit `NAME_COLUMNS`. A sender that is a `live_profile` reference is used by its display name
   only (no email), which is enough for masking.
6. **Which side spoke.** Assumed: a `direction` column (`inbound` = customer, `outbound` = agent or bot), a `sender_type` /
   `message_type` / `type` that says `bot`, `virtual` or `system`; otherwise the sender's name is matched against the record's
   `opened_for` (customer) and `assigned_to` (agent). Check: values of those columns on real rows. Wrong: edit `messageSide()`.
   When the sides cannot be told, the tab says so and waiting time is not worked out.
7. **System events** (joined, left, typing) are assumed to carry a `system` / `event` / `notification` / `join` / `leave` /
   `typing` type and are dropped. If they arrive as ordinary rows they appear as messages with an unknown side.
8. **Times.** Assumed: `sys_created_on` of a message, read as the stored UTC value (display_value=all returns it in `value`).
   The Chat tab's waiting time depends on it. Check: compare a message's stored time with what the form shows.
9. **The interaction record's columns.** Assumed on `interaction`: `number`, `short_description`, `state`, `type`, `opened_at`,
   `closed_at`, `assigned_to`, `opened_for`. The customer is assumed to be `opened_for`. Check: open the form's field list as a
   fulfiller. Wrong: edit `CHAT_CEILING` and the `chat-*` specs in `src/context/specs/knowledge.js`. A column a table lacks is just
   not returned. For `sys_cs_conversation`, `live_group_profile` and `chat_queue_entry` records most of these columns will be
   missing: only the number, state and messages are then shown.
10. **Ended chat.** Assumed: a closed chat has `closed_at` or a state matching closed / complete / ended / resolved / abandon /
    cancel. Wrong: edit `ENDED_STATE` in `src/chat/stats.js`.
11. **Insert into work notes.** The summary's "Suggested ticket notes" are inserted with the standard Insert into `work_notes` of the open form.
    Assumed: the interaction form (a task child) has `work_notes`; in Workspace the aria-label is "Work notes". If the form does
    not allow it, the person gets Copy. Check on a real chat in Agent Workspace and in the classic interaction form.
12. **Reply suggestions use the knowledge search** (`knowledge` read of the Related tab) with the chat's topic plus the customer's
    own words. Check that a typical chat finds a sensible article.

## Knowledge articles (C5, C6)

13. **Columns of `kb_knowledge`.** Assumed: `number`, `short_description`, `text` (HTML), `workflow_state` (stored value
    `published`), `kb_knowledge_base`, `kb_category`, `article_type`, `meta` (search keywords), `published`, `valid_to`,
    `sys_updated_on`, `sys_view_count` (or `view_count`), `author` (a `sys_user` reference). Check: `/api/now/table/kb_knowledge?sysparm_limit=1`
    as a fulfiller. Wrong: edit `KNOWLEDGE_CEILING` and the specs. Newer knowledge data models may use `topic` and `category` instead
    of `kb_category`; then the category scope and the "category" part of an article stay empty.
14. **Wiki-format articles** keep their body in another column (assumed `wiki`); Agent Buddy reads only `text`, so such an article
    shows "The text could not be read" instead of "No text".
15. **The author column.** Assumed `author` is read-allowed for fulfillers. If it is not, the pack has no author and a name written
    inside the article text is not masked (the firewall can only mask people it knows).
16. **Views.** Which of `sys_view_count` / `view_count` is filled, and whether a fulfiller can read it. If neither, the "hardly anyone
    reads it" check is skipped and the duplicate finder treats every article as 0 views (the keep suggestion then falls back to the newest).
17. **Dates.** `published`, `valid_to` are date columns, `sys_updated_on` a date-time. The stored (UTC) value is used for the checks; a
    display-format fallback understands only year-first and written-month formats.
18. **The Aggregate API on `kb_knowledge`** (`/api/now/stats/kb_knowledge?sysparm_group_by=kb_knowledge_base`) is used to list knowledge
    bases and categories with counts. Check that a fulfiller gets rows (ACLs apply to the aggregate too) and that the group value is the sys_id. If it
    is denied, the Duplicates tool cannot list scopes (the panel says so).
19. **What "published" means for the scope read:** `workflow_state=published^kb_knowledge_base=<id>` and ordering by
    `sys_updated_on`. Versioned articles may need `latest=true` to avoid older published versions; check for duplicates that are
    really two versions of one article, and add the condition in `readKnowledgeList` if so.
20. **Quality of the duplicate threshold** (0.55 on title words and neighbouring word pairs) is a guess. Try it on a real knowledge
    base; the panel does not expose the threshold, the op takes `threshold` (0.4 to 0.9).

## Knowledge gaps (C7)

21. **Where the link between a ticket and an article lives.** Assumed: `m2m_kb_task` (columns `task`, `kb_knowledge`; the "Attached Knowledge"
    list) and `kb_use` (articles viewed or used from a task). Which column of `kb_use` points at the ticket is NOT assumed any more
    (2026-10-30): `LINK_SOURCES` in `src/context/knowledge.js` lists `task_id` and `task`, and `detectLinkColumn` asks `kb_use` ONCE, with no
    filter, for one row and both column names. The Table API leaves out a column the table does not have, so that row says which one exists;
    the links are then read by that column. The probe is the same one-row read that "is this table empty or hidden?" needed anyway, so the
    number of reads stays the same when nothing is linked (one more when something is). The Check tab uses the same list and probe
    (`docs/live-questions/checks.md` question 11). Check as a fulfiller: (a) `GET /api/now/table/kb_use?sysparm_limit=1&sysparm_fields=sys_id,task_id,task`
    returns a row with exactly one of the two names (if it returns both keys, `task_id` is used: tell us which holds the ticket); (b) a column
    you cannot read because of a field ACL comes back as an empty value, not as a missing key (then "none" may be wrong for that table). If
    neither column exists, the radar and the Check tab say so and do not use `kb_use`. If neither table can be read, or a filter is not applied,
    the radar says "could not tell which tickets had an article" and counts every recent resolved ticket. A `kb_use` row (a view) counts as
    "has an article". Wrong column names: edit `LINK_SOURCES` only.
22. **`resolved_at` on `incident` and `sn_customerservice_case`**, and that `resolved_at>=YYYY-MM-DD HH:MM:SS` works as a condition for a fulfiller.
    The window is applied again locally against the stored time, so a condition the instance ignores is harmless.
23. **Who raised a ticket** is read from `caller_id` (incident) and `contact` / `consumer` (case) only so that their names stay out of the topic words and the
    privacy filter knows them. A name that is not the caller's (a colleague mentioned in a title) cannot be recognised.
24. **Performance.** 500 tickets and 300 articles are read with display values; check it is acceptable on a busy instance and that the
    link reads (about 13 requests per link table for 500 tickets, two at a time) do not trip rate limits.
