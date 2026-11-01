# Live questions: the answer area, "Ask about this ticket" and the check before sending (Answers agent, round 3)

What the Answers work (TRACKER.md AI0.4, AI0.5, AI0.2 preview, AI23 on an answer) assumes and could not check against a real
instance or a real model. Each item: what was assumed, how to check it as a non-admin user, what to change if it is wrong.

1. **Answers kept per ticket are keyed by instance host + table + sys_id.** Assumed: the panel's `page.record` has the same `table`
   and `sysId` for a ticket whether it was opened on the classic UI, Next Experience or a Workspace, so coming back to a ticket in
   another UI shows its answers. Check: summarise INC0010001 on the classic form, open it in the Service Operations Workspace, open
   AI Assist. If the answers are not there, the Workspace reports another table (`task`, say) for the same record: key the store on
   the resolved class (src/sidepanel/ticket/assist/answers/store.js `keyOf`).

2. **The number of a ticket found by its address.** The line on another ticket ("INC0010001: an answer is ready.") uses the number
   from the page, else the one the pack read. On a Workspace page found by its URL the number may be empty until the answer
   arrives; then the line says "another ticket". Check on dev364920 in a Workspace; if it is often empty, read the number with the
   header (TicketView already reads it) and pass it in.

3. **"Ask about this ticket" with a real model (V2).** The question is sent as a data part ("Question from the agent"), and the
   firewall's rules say data is never an instruction. Assumed: the model still answers the question (it is a question about the data,
   not an order). Check with DeepSeek on three questions ("When did the customer last reply?", "What has been tried?", "Is there a
   workaround?"). If the model refuses or answers "I can only summarise", adjust the wording of `ask-ticket` in
   src/features/packs/assist.js (prompt text only; the question must stay a part).

4. **"Your own instruction" (rewrite-own) with a real model (V2).** The agent's description of the wanted result is also a data part,
   and the untrusted-data rule tells the model to ignore instructions in data. Assumed: models follow the system prompt's explicit
   "rewrite the text so it matches that description" (a description, not an order). Check: "make it two sentences", "translate to
   German", "more apologetic". If the model ignores the description, the prompt (not the part) is what to change.

5. **Retries shown as "try 2 of 3".** The count comes from the pause before each new try in src/providers/http.js (429, 503, 529).
   Assumed: DeepSeek answers "busy" with one of those codes. Check by sending several long requests at once; if DeepSeek uses another
   code (500?), nothing is retried and nothing is shown, which is honest but not helpful: the retry statuses are the provider layer's.

6. **The short check ("Uses 3 solved tickets and 2 articles from other records").** Counted from the parts actually sent. Assumed the
   look-alike features keep their part handles (`reference_ticket`, `kb_article`, `linked_incidents`, `account_cases`, ...). A feature
   that sends other records under another handle gets the full check every time (never a vague short one): add the handle to
   `OTHER_RECORD_PARTS` in src/sidepanel/runLogic.js.

7. **Edit before Insert into a Workspace composer.** The edited text goes through the Actions agent's `insertText` like any insert.
   Assumed: a long, multi-paragraph edited text fills the Workspace composer as typed. Check on a real Workspace record (also F5).

8. **Answers in memory.** Kept for at most 10 tickets, 5 answers each, until the panel closes. Assumed this is acceptable for the
   security review (rule 7 allows in-memory caches). If the review wants them gone when the agent leaves a ticket for longer, call
   `forgetAnswers()` (exported from src/sidepanel/ticket/assist/answers/index.js) from the shell, for example when the site is turned
   off or on "Clear all".
