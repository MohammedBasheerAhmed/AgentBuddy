# Write and Knowledge

Every entry on the Write and Knowledge screens: what it does, how to use it, what it needs, and its limits.

## Write

The Write screen has two halves, like the Ticket screen. **Insights** needs no AI and sends nothing anywhere: it holds the Safe-to-send check and Snippets. **AI Assist** holds Rewrite and Notes to ticket. The email drafts and the customer reply draft are not on the Write screen: they live on the Ticket screen (AI Assist half, Reply group), and the "Which email fits" card is on the Ticket screen's Insights half.

Every Write line starts with "For INC0012345 - short description" (or "Open one to fill in its details." when no ticket is open), so you always know which ticket a snippet is filled from, which form a check reads, and where a rewrite goes.

Things that are true for every AI feature below:

- You see a "Check before sending" sheet first (unless you set "Check what is sent" to "Do not show it", or you saw it once for that action and kept the default "Show it the first time for each action"). It shows what was hidden, what will be sent, and a button "Send to AI".
- Nothing is saved or sent to the customer by Agent Buddy. "Insert" only fills a field on the open form; you press Save, Post or Send yourself.
- AI can be wrong. Read every draft.

### Customer reply drafts

- **What it does:** "Draft a reply to the customer" writes a short, polite reply to the latest customer message, using the rest of the ticket (state, notes, comments, SLAs, approvals, task chain) as background. The prompt tells the AI to be specific, answer what was asked, not promise a fix, a date or an outcome the ticket does not support, never quote internal work notes or internal team names, ask for missing information as a short numbered list, end with one short closing line, not sign with a name, and use at most 150 words. It is on the Ticket screen, AI Assist half, in the Reply group (the same Reply group offers "Suggest replies" on a chat).
- **How to use it:**
  1. Open the ticket (incident, request, requested item, catalog task, case, HR case or task).
  2. Switch to the AI Assist half and press "Draft a reply to the customer" (also: the keyboard shortcut named "Draft a reply", or the small bar on the ServiceNow page if it holds that action).
  3. Read the "Check before sending" sheet. Untick anything under "What goes in" that this one does not need, use "Hide something else" for a name you still see, then press "Send to AI".
  4. On the answer card press "Insert as customer comment" (or Copy). Use "Refine" to make it shorter, friendlier and so on, "More" for the other boxes.
  5. Review the finding list that Insert shows (see "Safe-to-send check"), then press Save or Post in the form yourself.
- **Needs / privacy:**
  - An AI provider and key (Settings, AI Assist), or a local model. Without a key the AI halves say how to set it up.
  - Sends masked text only; the ticket's people are masked exactly, other names are found by the words around them. The sheet shows the exact text.
  - Only for tickets that are not closed and that have a customer: a problem, or a task of a problem or change, gets no reply draft. "Where" the text goes depends on the kind: on an incident, request, requested item, case or HR case it goes into "Additional comments" ("Insert as customer comment"). On a catalog task or another task the requester may not see comments, so the first choice is "Add to work notes" and the comment is the second choice, labelled "Insert as a comment (the requester may not see it)" (or "...can read it" when the ticket's own data says the requester can).
  - The language follows the setting "Language of AI answers" (Settings, Basics, Language): the language of the ticket (default) or the language of the panel.
  - HR cases: only when your organisation allows HR content, and then only in Strict (or Local-only) privacy mode.
  - Your organisation can switch the feature off (`reply-draft`) or add extra instructions for everyone (a team lead can also add them under Settings, AI Assist, "How AI answers are written").
- **Limits:**
  - The work notes are given to the AI as background. The prompt keeps them out of the draft and the safe-to-send check flags six or more words in a row copied from a work note, but a paraphrase of internal content is not caught (docs/security.md, limit 14).
  - Insert is bound to the record the draft was written for: if you open another ticket, the Insert buttons turn off and the card says "This was written for INC0010001. Open that ticket again, or use Copy." (the ticket number differs).
  - On Workspace and portal pages Insert may fall back to Copy; Workspace insert is not verified on a real Workspace.

### The six email drafts

- **What it does:** Six AI drafts of an email to the person who raised the ticket. Each writes a "Subject:" line, a blank line, then a body with a greeting, short paragraphs and one closing line, at most 150 words, with no signature and no promised date unless the ticket states one. Work notes are used only to understand what happened and are never quoted.

| Draft (button title) | Choice name | What it is for | Offered when |
| --- | --- | --- | --- |
| Draft an email asking for information | Ask for information | Asks for what is still needed, or sends a friendly reminder if you already asked. Questions go in a short numbered list; never asks for passwords or security codes. | New or being worked |
| Draft a status update email | Status update | Where the ticket stands, what happens next, and when the person will hear from you only if the ticket states a date. Explains a hold in plain words. | New or being worked |
| Draft a resolution email | Resolution | Says it is resolved and what was done, in one or two plain sentences, and asks them to reply if the problem is still there. | Being worked or resolved |
| Draft an approval reminder | Approval reminder | A courteous reminder that an approval is still waiting; addressed to the approver named in the data if there is one. | Requests, requested items and catalog tasks that are new or being worked |
| Draft an apology for the wait | Apology for the wait | A short, sincere apology for the delay or missed target, with what is being done now. No excuses, no compensation, no promised fix date. | Being worked |
| Draft a closure email | Closure | Tells the person the ticket is closed (or about to be), one sentence on the outcome, and that they can contact the service desk again. | Resolved or closed |

If Agent Buddy cannot tell the stage of the ticket, none of these is hidden.

- **How to use it:**
  1. Open the ticket. Optionally open the "Which email fits" card on the Insights half to see which kind fits now (next entry).
  2. On the AI Assist half, Reply group, choose the draft you want and pass the "Check before sending" sheet.
  3. On the answer card press "Open the email form". The email form of this ticket opens in a new tab and the draft waits in memory (for 15 minutes, on that site only).
  4. In the email form, the card at the top of the panel offers "Insert subject" and "Insert body". Review, edit, then press Send in the email form yourself. ("Nothing is sent until you press Send in the email form.")
  5. If the form cannot be opened, press "Copy body" (or "Copy subject" / "Copy all" under "More").
- **Needs / privacy:**
  - An AI provider and key. Masked text only, shown in one "Check before sending" sheet for all six (they share one check).
  - The draft also carries "Status worked out by Agent Buddy" lines (for example "The last message came from the person", an approval that is waiting, a service level missed) and, for the approval reminder, who still has to approve. Names in those lines are masked too.
  - Each draft has its own feature id so your organisation can switch it off: `email-ask-info`, `email-status-update`, `email-resolution`, `email-approval-nudge`, `email-apology`, `email-closure`.
  - Email drafts can be inserted only when the ticket's email form can be reached. On "Insert body" the safe-to-send check runs on the body.
- **Limits:**
  - Works for incident, request, requested item, catalog task, case and HR case.
  - The draft is kept in memory for 15 minutes, only for the site and ticket it was written for. If you wait longer, press Copy or draft again.
  - Agent Buddy never sends the email.

### Which email fits (the email recommendation)

- **What it does:** A card on the Ticket screen's Insights half, "Which email fits", that tells you which of the six email kinds suits the ticket right now, with a one-line reason for each of up to three suggestions, plus a plain template to copy. No AI: it is worked out on your computer from the ticket's state, hold reason, last message (who wrote it and how long ago), approvals, service levels, how long the ticket has been open and how thick the description is. Examples of reasons it gives: "It is marked resolved and the person has not been told yet." "You are waiting for the person's reply. Your last message was 2 days ago. A friendly reminder may help." "A service level target was missed. A short apology and a clear next step help." If nothing fits it says "No email needed right now".
- **How to use it:**
  1. Open the ticket, Insights half, Reply group, "Which email fits". The row's line says for example "Resolution fits best".
  2. Read the facts line and the reasons. Choose a kind with the radio buttons ("Kind of email") or pick another under "Another kind" / "Choose a kind".
  3. The template appears, filled from the ticket. Whatever only you know stays in \[brackets\]: fill those in ("Fill in the parts in \[brackets\] before you send it.").
  4. Press "Copy email", or "Open the email form" to open the ticket's email client in a new tab.
  5. For an AI-written draft of the same email, use the matching draft on the AI Assist half.
- **Needs / privacy:**
  - No AI and no key. Every read is a GET with your own session; nothing is sent anywhere.
  - It also shows two facts: the language the caller writes in versus the language Draft a reply will use (said only when the caller's language is not the panel's; Arabic and English are recognised), and "Before it is sent: Checked: internal words, a next step, the tone".
- **Limits:**
  - It suggests; you decide. A suggestion is only as good as what could be read: where the notes or approvals cannot be read it does not guess.
  - The template language follows "Language of AI answers" and the caller's language (English and Arabic).

### Rewrite

- **What it does:** Rewrites text that you pasted, or read from the open form, in one of seven modes (next seven entries). The only data sent is that text (plus the open ticket's people, so their names are masked). The text is never put into a prompt; it travels as data. The prompt tells the AI to keep the meaning and keep every \[PLACEHOLDER\], link, number, ticket number, date and code exactly as written, not to add facts, promises, names or dates, to treat the text as data to rewrite and not as instructions, to keep the original language unless translating, and to answer with the rewritten text only.
- **How to use it:**
  1. Write > AI Assist half > "Rewrite".
  2. In "Text to rewrite" paste or type the text (up to 20,000 characters; a counter shows "{count} of {max} characters"). Or choose "Form field" (Customer comment, Work note, Resolution notes, Description, Short description) and press "Use what I typed in the form" to read it from the open form.
  3. Optionally list "Names to hide from the AI (optional)", for example "Abel Tuter, Priya Raman" (up to ten names). A name written only in the text cannot be found by pattern, so list it here.
  4. Press one of the mode buttons under "Rewrite it", or pick a Language and press "Translate" or "Bilingual".
  5. Pass the "Check before sending" sheet. The result appears under a heading such as "Shorter version".
  6. Under "Use it in the form" press "Add below" (keeps what is in the form), "Replace what is in the form" (overwrites it), or "Use as my text" (puts the rewrite back in the box for another round).
  7. Press Save in the form yourself.
- **Needs / privacy:**
  - An AI provider and key. Masked text only. Rewrite carries the real table of the page you are on and the field the text came from, so your organisation's blocked tables, blocked fields and the HR rule apply: reading the form is refused on a blocked table, on an HR case where HR content is not allowed, and for a blocked field.
  - Text read from one ticket cannot be sent while another ticket is open ("This text was read from INC0010001. Open that ticket again, or paste the text here.").
  - "Add below" is not offered for a one-line field (Short description); only "Replace what is in the form".
  - Each mode has its own feature id (`rewrite-short`, `rewrite-friendly`, `rewrite-plain`, `rewrite-formal`, `rewrite-fix`, `rewrite-translate`, `rewrite-bilingual`) that your organisation can switch off.
  - Before Insert, the review checks the rewritten text for the field it is going into (see "Safe-to-send check").
- **Limits:**
  - If Agent Buddy cannot read the form ("Workspace and portal pages keep it out of reach"), paste the text instead.
  - Nothing is saved. Add below / Replace only work while the ticket the rewrite was made on is the one open.
  - A rewrite can change tone and still be wrong: read it before it goes to a customer.

### Rewrite mode: Shorter

- **What it does:** Makes the text shorter and tighter. Removes filler and repetition but keeps every fact, request and next step. Result heading: "Shorter version".
- **How to use it:** Put the text in "Text to rewrite" and press "Shorter".
- **Needs / privacy:** AI key; masked text; feature id `rewrite-short`.
- **Limits:** It keeps facts, so a text that is already tight changes little.

### Rewrite mode: Friendlier

- **What it does:** Makes the tone warmer and friendlier while staying professional and honest. It must not add apologies or promises that are not in the text. Result heading: "Friendlier version".
- **How to use it:** Put the text in "Text to rewrite" and press "Friendlier".
- **Needs / privacy:** AI key; masked text; feature id `rewrite-friendly`.
- **Limits:** It will not invent an apology or a promise for you; add those yourself if they are right.

### Rewrite mode: Plain language

- **What it does:** Rewrites in plain language: short sentences and everyday words, no jargon (an acronym is explained only if the text already explains it). Result heading: "Plain-language version".
- **How to use it:** Put the text in "Text to rewrite" and press "Plain language".
- **Needs / privacy:** AI key; masked text; feature id `rewrite-plain`.
- **Limits:** Technical terms that the customer needs may be simplified; check them.

### Rewrite mode: More formal

- **What it does:** Makes the tone more formal and professional without making it cold or longer than needed. Result heading: "More formal version".
- **How to use it:** Put the text in "Text to rewrite" and press "More formal".
- **Needs / privacy:** AI key; masked text; feature id `rewrite-formal`.
- **Limits:** None beyond the shared ones.

### Rewrite mode: Fix spelling and grammar

- **What it does:** Corrects spelling, grammar and punctuation only, and changes as little else as possible. Result heading: "Corrected version".
- **How to use it:** Put the text in "Text to rewrite" and press "Fix spelling and grammar".
- **Needs / privacy:** AI key; masked text; feature id `rewrite-fix`.
- **Limits:** It is a model, not a spell checker with a dictionary: still read the result.

### Rewrite mode: Translate to

- **What it does:** Translates the text into the language you pick, keeping the tone and the layout of the original. Result heading: "Translation". The language list is fixed (English, Spanish, French, German, Portuguese, Italian, Dutch, Polish, Hindi, Arabic, Chinese (Simplified), Japanese); the name goes into the instruction, nothing you type does.
- **How to use it:**
  1. Put the text in "Text to rewrite".
  2. Choose a "Language" (the default in the list is Spanish).
  3. Press "Translate".
- **Needs / privacy:** AI key; masked text; feature id `rewrite-translate`.
- **Limits:** Only the twelve listed languages. Placeholders, links, numbers and dates are kept as written.

### Rewrite mode: Bilingual (original and translation)

- **What it does:** Writes the original text first, exactly as given (an obvious typo may be fixed), then a line with three dashes (`---`), then the translation into the language you pick. Result heading: "Original and translation". Useful when the customer should see both languages in one message.
- **How to use it:**
  1. Put the text in "Text to rewrite".
  2. Choose a "Language".
  3. Press "Bilingual".
- **Needs / privacy:** AI key; masked text; feature id `rewrite-bilingual`.
- **Limits:** Same languages as Translate. The `---` separator line is part of the text: remove it if you do not want it.

### Refine an answer with your own instruction

- **What it does:** Every AI answer card has a "Refine" menu ("Refine this answer"). It offers the same quick rewrites (the rewrite presets), "Translate to" a language, and "Your own instruction" (a line of up to 500 characters, for example "Two sentences, and mention the reboot") with the button "Rewrite". Use it to adjust a draft in place instead of starting again.
- **How to use it:**
  1. On an answer card press "Refine".
  2. Press a preset, or choose a language and press "Translate", or type your own instruction (at least five characters) and press "Rewrite".
  3. The refinement is a rewrite of the answer's text: it goes through the "Check before sending" sheet like any other AI call, and arrives as a new answer labelled "Shorter", "Translated to French" or "Your instruction". It counts as the answer it came from, so Insert puts it where the original draft would have gone.
- **Needs / privacy:** AI key; masked text (the names masked in the first run stay masked). The feature id of your own instruction is `rewrite-own`; each preset uses the rewrite ids above, so your organisation can switch any of them off. If it switched all the rewrite tools off the menu says "Your organisation has switched the rewrite tools off."
- **Limits:** Your own instruction must be at least five characters and is limited to 500. It shapes the wording; the privacy and fact rules still apply. Not verified here: how a refinement behaves on answers whose headings the panel reads back (resolution notes, hand-off brief).

### Notes to ticket

- **What it does:** Turns rough call, chat or walk-up notes into a proposal for a new ticket: a short description (one line, up to 100 characters asked for, 160 kept), a description (two to five lines), Impact, Urgency, a category hint, a contact type and up to four questions still to ask. You review and edit the proposal, then fill a blank incident or case form. Only five fields can ever be filled: Short description, Description, Impact, Urgency and Contact type. A value the AI made up that is not on the form's list is never passed on (Impact and Urgency must be High, Medium or Low; Contact type must be Phone, Self-service, Email or Walk-in). It also shows "Suggestions to pick on the form" worked out without AI from similar resolved tickets: the Category and Assignment group most of them used (shown only when at least two of up to ten best look-alikes agree and they are more than a third of them), and for each name you listed under "Names to hide" the active users with exactly that name (up to three names), with department and email, so you can tell namesakes apart. These are only shown: Agent Buddy never fills caller, category or group.
- **How to use it:**
  1. Write > AI Assist half > "Notes to ticket".
  2. Paste or type rough notes in "Rough notes from the call, chat or visit" (for example "vpn down since this morning, error 809, tried restart, urgent for sales team...").
  3. List the people's names under "Names to hide from the AI (optional)". Emails, phone numbers and card numbers are hidden automatically; a name written only in the notes is not.
  4. Press "Write the ticket" and pass the "Check before sending" sheet.
  5. If no blank form is open, press "Open a blank incident" (or "Open a blank case" for customer service). The form opens (in this tab, or a new tab); your notes and the proposal stay in the panel.
  6. Under "Review, then fill the form" edit the short description, description, Impact, Urgency and Contact type ("Leave as is" keeps a choice empty). Read "Suggestions to pick on the form" and "Questions still to ask".
  7. Press "Fill the form". If the form already has a short description or description, or the review found something serious, a "Check before filling:" list appears with "Fill anyway" and "Cancel".
  8. Pick caller, category and group on the form yourself, then Save the ticket yourself. ("Filled: Short description, Description. Review the form, then save the ticket yourself.")
  9. Or press "Copy short description", "Copy description" or "Copy all".
- **Needs / privacy:**
  - An AI provider and key. Only the notes you typed are sent, masked; the open page's real table is attached so blocked tables and the HR rule apply.
  - The feature is shown for the IT and customer service work profiles; "Show everything" (Settings, Basics) shows it for others. Feature id: `notes-to-ticket`.
  - Filling works on a new, empty incident or case form only. On a case form Impact, Urgency and Contact type are not filled (the incident form's lists are used); on an incident all five can be.
  - The short description and description are reviewed the way a customer comment is (the customer may read them on a portal).
- **Limits:**
  - "Fill works on a new, empty incident or case form. Open one, or copy the text." On any other page only Copy works.
  - Values it does not recognise are listed ("Not filled, because Agent Buddy does not recognise the value: ...").
  - Category, assignment group and caller are never filled. The suggestions need read access to resolved incidents or cases and to users; where those cannot be read they are simply missing.

### Personal snippets

- **What it does:** Canned replies you write once and reuse, with `{{variables}}` filled from the open ticket. No AI, no key, nothing sent anywhere. Snippets are stored only in this browser. Three sources show as one list: your own, your organisation's (read-only, marked "From your organisation"), and ones you add from a file. Each has a title (up to 80 characters), an optional "Search word" (up to 30 characters of a-z, 0-9, dash, underscore, slash; it only makes the snippet quick to find in the search box and is never typed into a ServiceNow page), and the text (up to 8,000 characters). Up to 500 snippets.
- **How to use it:**
  1. Write > Insights half > "Snippets". If the library is empty, press "Add three examples" (Greeting, Asking for details, Closing note) and edit them.
  2. To make one, press "New snippet": fill "Title", "Search word (optional)" and "Text", and press "Variables" to see the list and "Add" to put one into the text. The editor shows a "Preview" filled from the open ticket (or example values when no ticket is open, clearly said), and warns about variables Agent Buddy does not know. Press "Save".
  3. To use one: search by title, search word or text, press its row, check the preview ("Filled from INC0010001."), choose "Insert into" (the fields offered depend on the kind of ticket: for an incident or case Customer comment, Work note, Resolution notes and Description; for a problem also Cause notes, Workaround and Fix notes; on an email form "Email body"), then press "Insert" (adds below what is in the field) or "Copy". "Refresh values" re-reads the ticket.
  4. If a variable has no value, a note lists it ("Some values are missing. If you insert now, these stay as written in the text: ...") with "Insert anyway" and "Cancel".
  5. Press Save in the form yourself.
  6. Back up or share: "Back up or share" offers "Save to a file", "Add from a file", "Copy as text" and "Paste instead" / "Add these snippets". Only your own snippets are exported (titles, search words and texts, no ids or dates). Importing skips a snippet whose search word is taken or which repeats an existing title and text; nothing is overwritten; up to 2,000 entries are read from a file.
- **Needs / privacy:**
  - No AI, no key. A snippet is filled with ticket data only in memory, at the moment you preview or insert it. What is kept is your own wording, never ticket content.
  - Organisation snippets come from the policy key `orgSnippets` (at most 200); you cannot edit or delete them in the panel.
  - When the target field is one the customer reads, Insert runs the safe-to-send review first and may show findings.
  - Deleting asks "Delete this snippet?" (Yes, delete / No).
- **Limits:**
  - The text is added below what is there (append); it never replaces a field.
  - A snippet cannot be inserted into a one-line field, nor into a field Agent Buddy cannot write to.
  - Snippets are per browser profile; use the file to move them.
  - Values are never expanded again: a value that itself contains {{x}} is inserted as written.

### Snippet variables

- **What it does:** A variable is a name between double braces that is replaced when you preview or insert a snippet: `{{caller.first_name}}`. You can add a fallback after a bar, used when there is no value: `{{caller.first_name | there}}`. It is fill-in-the-blanks only: no calculations, no code. A name with no value and no fallback stays visible as `{{name}}` and is listed so you can fix it. Names are case-sensitive. Built-in variables (the example column is what the preview shows with no ticket open):

| Variable | Meaning | Example |
| --- | --- | --- |
| `{{caller.first_name}}` | The caller's first name (requester, contact or subject of the ticket) | Abel |
| `{{caller.last_name}}` | The caller's last name | Tuter |
| `{{caller.name}}` | The caller's full name | Abel Tuter |
| `{{number}}` | Ticket number | INC0010001 |
| `{{short_description}}` | Short description of the ticket | Cannot connect to VPN |
| `{{state}}` | State of the ticket (display value) | In Progress |
| `{{priority}}` | Priority of the ticket (display value) | 2 - High |
| `{{assigned_to.name}}` | Who the ticket is assigned to | Beth Anglin |
| `{{agent.first_name}}` | Your first name | Beth |
| `{{agent.name}}` | Your full name | Beth Anglin |
| `{{sla.due}}` | When the next SLA is due | 2026-10-27 09:00:00 |
| `{{today}}` | Today's date (YYYY-MM-DD) | 2026-10-26 |

- **How to use it:**
  1. In the snippet editor press "Variables", then "Add" next to a variable to insert it where the cursor is.
  2. Write a fallback with a bar for values that may be missing: `{{caller.first_name | there}}`.
  3. Check the "Preview". A variable the app does not know (usually a typo such as `caller.firstname`) is flagged: "Agent Buddy does not know this variable ... Check the spelling, or add a fallback."
- **Needs / privacy:**
  - The values come from the open ticket (read with your own session) and from you (your name from the page). The ticket is read only while a snippet is shown or edited; the read asks for the columns the variables use, the people and the SLAs, and no notes.
  - Why a value may be missing, as the panel says it: "No caller is known for this ticket." / "Your name is not available on this page." / "The ticket is not assigned to anyone." / "The ticket has no open service level." / "The ticket has no value for this."
- **Limits:**
  - Only these twelve names exist. A placeholder that is not well formed (spaces inside the name, an unclosed `{{`) stays as plain text.
  - `{{sla.due}}` is the next open service level's due time as shown to you; it is not a promise to the customer.
  - Without a ticket open, the preview uses example values (clearly labelled) but Insert uses only real values.

### Safe-to-send check

- **What it does:** "Check my comment" (the button follows the field: "Check my comment", "Check my resolution notes", "Check my description") scans what you typed for personal data, passwords, internal wording, a next step and the tone, before the customer sees it. It is local rules and word lists; no AI, nothing leaves your browser and nothing is kept. The fields you can check are the multi-line fields the customer can read: Customer comment, Resolution notes and Description. A work note is internal and is not checked. The same review also runs automatically every time you Insert text into a field the customer can read (an AI answer, a snippet, a draft email body).
- **How to use it:**
  1. Type your comment (or resolution notes, description) in the ServiceNow form but do not post it yet.
  2. Write > Insights half > "Safe-to-send check". Choose "Field", then press "Check my comment".
  3. Read the result: "Nothing found" / "{n} to check before sending" / "{n} worth a look". Each finding gives advice and a masked excerpt (never the whole value).
  4. If the form cannot be read, press "Paste the text instead", paste the message ("Paste the message you are about to send") and press "Check this text".
  5. Fix the text in the form, check again, then post.
- **Needs / privacy:**
  - No AI, no key, no network. It reads the form on the classic UI through the page bridge, plus the ticket's people and work notes (so the record's own people are not flagged and words copied from a work note are caught). If those cannot be read: "The ticket's people and notes could not be read, so names and copied notes were not compared."
  - Your organisation can add its own internal-only phrases (policy key `internalPhrases`); they are added to the built-in list, never replace it.
- **Limits:**
  - "This check cannot catch everything, so give it a last read." A clean result does not prove the text is safe.
  - If the form on the page is not the open ticket: "The form on the page is not INC0010001. Open that ticket again, or paste the text below." On Workspace and portal pages: "Agent Buddy cannot read the form on this page (Workspace and portal pages keep it out of reach). Paste the text below instead."
  - Name hints are guesses from cue words, not a name detector.

### What the safe-to-send check catches

- **What it does:** Findings are split into "to check before sending" (serious: high or medium) and "worth a look" (low; shown, never block anything). Each carries only a masked excerpt such as "ab\*\*\*\*@x.com".
  - **Serious (high):** a password or secret key; a link that contains a username and password; a payment card number; a bank account number (IBAN); a national identity number; markup (an HTML tag, `[code]` or a script link: a journal field shows `[code]` as live HTML); something the privacy filter hid on the way out and the AI brought back (a password, key, card or ID number back in the draft).
  - **Serious (medium):** a date of birth; a postal address; an employee or staff id; a phone number; an email address that is not one of the people on this ticket; a marker such as \[PERSON\_1\] that was never replaced; six or more words in a row copied from an internal work note of the same ticket (for resolution notes this is only a hint, because notes are written from the work notes); internal-only wording (medium unless noted).
  - **Worth a look (low):** an IP address; a device (MAC) address; the name of someone who is not on this ticket, introduced by a cue such as "your colleague", "manager", "customer", "assigned to", "on behalf of"; "escalated to"; a link (named by its site only; links are normal but a requester can plant one in a ticket); the tone; and, for a reply, a missing next step.
  - **Built-in internal phrases:** "internal only", "do not share", "work note", "workaround for admins", "escalated to" (low), "root password" (high), "vpn token" (high).
  - **Tone** (one line, the most telling): a phrase that sounds like blame or impatience (examples: "as I said", "per my last email", "you should have", "obviously", "calm down", "for the last time", "not my problem", "your fault"), else a long run of capital letters (shouting), else three or more exclamation marks. English and Arabic.
  - **Next step** (replies only, i.e. the customer comment and the email body): "Say what happens next, or when you will write again." It appears when a reply of seven or more words has no promise ("will", "I'll", "we will"), no time ("tomorrow", "within 2 hours", "by 5pm"), and asks nothing of the customer ("please confirm", a question). Texts in another language than English or Arabic are not judged.
- **How to use it:** You do not need to do anything for the review at Insert: findings appear above the Insert buttons. A serious finding stops the insert until you choose "Insert anyway" or edit the text first; low findings never stop it.
- **Needs / privacy:**
  - It uses the same detectors as the privacy filter, so it catches the same kinds of personal data (email, phone, card, IBAN, national id, IP, MAC, date of birth, address, employee id, secret, link with credentials).
  - Nothing about this review is sent anywhere.
- **Limits:**
  - Pattern based: a missing finding proves nothing; a hint is a nudge, not a rule.
  - The next-step and tone lists exist for English and Arabic only.
  - A paraphrase of an internal note passes.

## Knowledge

The Knowledge screen also has two halves. **Insights** (no AI): "Articles for the open ticket" (a line when no ticket is open), "Knowledge search", and for knowledge managers "Duplicate articles" and "Articles to write". **AI Assist** (knowledge managers): "Merge duplicate articles" and "Outline a missing article". The duplicate finder and the gap radar are for the Knowledge manager work profile (Settings, Basics, "What you work on"); without it the AI Assist half says "Merging duplicate articles and outlining missing ones are for knowledge managers. Add the Knowledge manager work profile in Settings to use them." Where the guide below says "not verified", the code assumes a table or column that was not checked on a real instance (docs/live-questions/knowledge.md says none of the chat or knowledge reads was checked on a real instance).

### Article from a ticket

- **What it does:** "Draft a knowledge article" turns a solved ticket into a draft article for other people: Title (at most 12 words, the way a user would search for it), Symptoms, Cause (or "Not confirmed in the ticket"), Resolution, Steps (numbered), and "Applies to". It first checks existing articles: if there is a strong match the first line of the answer is "Similar article exists: \<number> \<title>. Consider updating it instead." The draft must contain no name, email, phone, ticket number, device name, hostname, IP, account or employee id: masked values are not allowed to come back into it ("keepMasked"). At most 250 words.
- **How to use it:**
  1. Open a solved ticket (incident, problem, case, requested item or task) that is not new. The action is in the Resolve group of the AI Assist half.
  2. Press "Draft a knowledge article" and pass the "Check before sending" sheet. Because the request includes text from existing articles, the sheet is shown every time ("This one includes other tickets, so you are always asked.").
  3. On the answer card press "Open a new article form" (a blank knowledge article form opens). The draft waits for 15 minutes, on that site only.
  4. On the blank form use "Insert title into the article form" and "Insert body into the article form".
  5. Read it, fill any \[placeholder\], and publish through the article's own workflow yourself.
- **Needs / privacy:**
  - An AI provider and key. Up to 25 notes of the ticket are read (without authors or times) and matching articles are searched for. Masked text only.
  - Shown to the IT, customer service and knowledge manager profiles. Feature id `kb-article-draft`.
  - Plain text becomes escaped HTML when it goes into the article body, so a tag in the draft is shown as characters, never a live tag.
- **Limits:**
  - If the ticket has no confirmed resolution the draft says "Not confirmed in the ticket" and lists only the steps the notes support.
  - Whether a person may create an article depends on each knowledge base's contributor rules, not on a role (docs/live-checks-2026-11-07.md), so the button is not hidden by role.
  - Not verified on a real instance: Insert into the article form on Workspace.

### Article checks

- **What it does:** When a knowledge article is open, the "Article checks" card (Ticket screen, Insights half, for the Knowledge manager profile) runs plain, local checks on it and lists findings worst first, each marked "Fix", "Check" or "Consider". It also shows tags: words, headings, "changed ... ago", views, keywords. If all is well: "No problems found in this article." What it checks, with the thresholds from the code:
  - **Title:** missing; vague ("Issue", "FAQ", "Help"...); shorter than 15 characters or three words; longer than 100 characters; contains a ticket number; all capitals.
  - **Text:** empty; under 300 characters; over 8,000 characters; unfinished markers (TODO, TBD, lorem ipsum, XXX, FIXME); wiki-format articles are not read.
  - **Structure:** over 1,500 characters with no headings; reads like instructions (three or more action verbs) but has no numbered steps; no prerequisites ("Before you begin"); three or more images and under 500 characters of text.
  - **Keywords:** none, or fewer than three.
  - **Freshness:** not changed for over a year (Check) or over two years (Fix); expired (Fix); expires within 30 days (Check) or within about 60 (Consider); fewer than 10 views after 180 days live (Consider).
  - **State:** an unpublished article is noted ("This article is not published").
  - **Secrets:** "May contain a password, key or card number" if the text holds passwords, keys, card numbers, IBANs or ID numbers (email addresses and phone numbers are normal in an article and are not counted).
- **How to use it:**
  1. Open the article in ServiceNow (the Ticket screen follows the page).
  2. Insights half, "Article checks" (open by default for an article).
  3. Read the findings. Fix the article in its own form, then press "Check again".
- **Needs / privacy:** No AI, no key; the article is read with your own session and the checks run on your computer. Nothing is sent. It reads again each time the card is shown (an article may have been edited).
- **Limits:**
  - A finding is "a prompt to look, not proof of a fault".
  - Formatting (headings, bold) is judged from the HTML where it could be read; the AI's improvement tool below works on plain text and cannot see formatting.

### Suggest improvements (article optimise)

- **What it does:** "Suggest improvements" is the AI companion of the article checks. It reads the open article (title, text, search keywords, category, format and dates) and answers under fixed headings: Title, Keywords, Structure, Clarity, Missing, Looks outdated, each with at most three bullets, "Nothing to add" where nothing applies, at most 250 words. It does not rewrite the article.
- **How to use it:**
  1. Open the article.
  2. Ticket screen, AI Assist half, "Suggest improvements".
  3. Pass the "Check before sending" sheet.
  4. Read the suggestions and edit the article in its own form (the answer is Copy only; nothing is inserted).
- **Needs / privacy:** An AI provider and key. For knowledge managers (feature id `article-optimise`). The article text is sent masked.
- **Limits:**
  - The text is converted from HTML to plain text, so the AI cannot see headings or formatting and is told not to complain about it.
  - Suggestions are based only on the article text; check them before you apply them.

### Duplicate finder

- **What it does:** Finds groups of published articles whose titles read alike, so a knowledge manager can compare and merge them. No AI. It compares titles only (words and neighbouring pairs of words), 300 articles at a time, newest changed first, up to five pages (1,500 titles) in one scan; a group is formed when titles are at least about 55% alike and share at least two words (an exact repeat of the same words says "The titles use the same words."). Article text is read only for the two to four articles of a group you pick. Each result says how much was looked at ("Compared 300 of 1,240 articles in IT Knowledge Base."), and "No duplicates found." is said only when everything in the scope was compared.
- **How to use it:**
  1. Knowledge > Insights half > "Duplicate articles" (a folded section; open it).
  2. Choose a "Knowledge base" and, if you like, a "Category (optional)". Press "Find duplicates".
  3. Read the groups ("{n} articles that read alike", why they are a group, views and last change, "Most read: KB0010001" as the suggested one to keep). Each article opens in its authoring form in a new tab.
  4. Press "Compare the next {n}" to add the next 300 titles. Press "Stop" to cancel a scan.
  5. Press "Compare" on a group, choose two to four articles, and press "Compare their text": each pair shows how much of the shorter text also appears in the other.
  6. "Export groups (CSV)" saves the groups as a file (group, number, title, knowledge base, category, views, last changed, suggested to keep).
  7. To draft one merged article, switch to the AI Assist half (next entry).
- **Needs / privacy:**
  - No AI, no key. Reads are GET with your own session. Only articles you can read are compared; "The other {m} could not be read; your role may hide them." says when some could not be.
  - For the Knowledge manager profile. Blocked tables apply.
- **Limits:**
  - Only published articles. A scan stops at 1,500 titles: for a bigger base choose a category ("Only the 1,500 most recently changed articles were compared... Choose a category to narrow it.").
  - At most 100 groups are shown ("Showing the 100 biggest of 161 groups.").
  - Groups are star-shaped around the most-read article: article A like B and B like C never puts A and C together.
  - Titles decide the groups; the text figure only helps you judge.

### Merge draft (draft a merged article)

- **What it does:** Drafts one article from the near-duplicates you compared in the Duplicate finder. The answer has: Merged title (under 90 characters), Merged article (what it is for, "Before you begin", numbered steps, "If this does not work"), Retire (the article numbers the merged article replaces, and which one to keep), and "What changed" (what was combined, dropped or reworded, and every place the articles disagree). At most 600 words. Where articles disagree it keeps the safer wording and lists the conflict.
- **How to use it:**
  1. Insights half: compare a group's text first ("Compare their text").
  2. Knowledge > AI Assist half > "Merge duplicate articles". The group appears with its article numbers.
  3. Press "Draft a merged article" and pass the "Check before sending" sheet.
  4. Read it, put back any hidden details ("Hidden details show as placeholders such as \[EMAIL\_1\]: put the real ones back before you publish."), and create or update the article in ServiceNow yourself. The answer is Copy only.
- **Needs / privacy:**
  - An AI provider and key. Sends the two to four articles' number, title, text (up to 3,500 characters each) and keywords, masked; no ticket data. The authors' names are masked where the text mentions them. Feature id `kb-merge-draft`; for knowledge managers.
  - Until a group is compared the section says "Find duplicate articles in Insights, pick a group and compare its text. The group then shows up here." The group is kept in memory only, per ServiceNow instance, and is forgotten when the panel reloads.
- **Limits:**
  - It does not retire or edit anything. "Retire" is advice.
  - Masked values stay masked in the draft (keepMasked): you fill them in.

### Knowledge-gap radar

- **What it does:** "Articles to write": finds topics that keep coming up in recently resolved tickets that have no knowledge article. No AI. It groups resolved tickets by shared keywords of their titles (email addresses, links, phone numbers, record numbers and the caller's own name are ignored), then by shared category and configuration item, and ranks the topics by how many tickets they hold, with "{n} tickets, {m} with a written fix" (a fix is resolution notes of at least 40 characters, which an author can borrow). A topic needs at least two tickets; at most 15 topics. Tickets that already have an article are left out when that can be read ("{n} already had an article.").
- **How to use it:**
  1. Knowledge > Insights half > "Articles to write" (folded; open it).
  2. Choose "Resolved in the last" 30, 60 (default) or 90 days; "Whose tickets": "Everything I can see", "My groups" or one category; and "Tickets to look at": Incidents (on by default) and Customer service cases (off by default).
  3. Press "Find topics". "Stop" cancels.
  4. Read the line "Looked at 500 of 12,400 tickets resolved in the last 60 days in your groups." and the topics, each with its category and item and up to three example tickets (open in a new tab).
  5. "Export topics (CSV)" saves the topics (topic, tickets, with a written fix, category, configuration item, example ticket numbers; numbers only, never titles, because a title can name a person).
  6. To outline an article, switch to AI Assist (next entry).
- **Needs / privacy:**
  - No AI, no key. Reads titles, categories and configuration items of at most the newest 500 resolved incidents or cases. HR cases are deliberately not read.
  - For the Knowledge manager profile.
- **Limits:**
  - Looks at titles, not text; a topic is a guess at "what the tickets are about", ranked by volume.
  - If it cannot tell which tickets have an article, it says so and counts every recent resolved ticket ("Could not tell which tickets had an article, so every recent resolved ticket is counted...").
  - When no topic comes up more than once: "No topic came up more than once. Try a longer window or a wider scope."

### Outline a missing article

- **What it does:** Drafts an outline for one topic from the gap radar. The answer has: Suggested title (under 90 characters, in the words a user would search), "Who it is for", Outline (numbered sections such as Symptoms, Cause only if the data suggests one, Steps, How to check it worked, When to ask for help), and "Facts to collect first" (what the author still has to find out from the resolved tickets). At most 200 words.
- **How to use it:**
  1. First run "Find topics" in the Insights half.
  2. Knowledge > AI Assist half > "Outline a missing article". Choose a "Topic to outline" (it lists the topics with their ticket counts).
  3. Press "Draft an article outline" and pass the sheet. The answer is Copy only.
- **Needs / privacy:**
  - An AI provider and key. Only the topic words, the counts, the category and the configuration item are sent: "no ticket text". The callers' names are known to the filter so a name that shows in a topic word is masked. Feature id `kb-gap-outline`; for knowledge managers.
  - Until topics exist: "Find topics under "Articles to write" in Insights first. They then show up here." The topics are kept in memory only, per instance.
- **Limits:** It does not write the article. It cannot invent causes, fixes, versions or links, so "Facts to collect first" is the real work.

### Knowledge search

- **What it does:** A search box over the published articles you can read, ranked like the ticket's "Knowledge for this ticket" card. No AI. It reads up to 25 articles that contain every word you typed in the title or text (or, when that finds few and there are several words, any word, ranked below), drops articles past their "valid to" date, ranks (a word in the title counts double one in the text), then most read, then newest, and shows the best ten. Type an article number such as KB0010001 to look it up directly. Results show number and title (a link that opens the article), knowledge base, category, how fresh it is (an article not updated for over a year or expiring within 30 days gets a warning chip), a short excerpt, and "Copy link". With a ticket open, the screen starts with "Articles for INC0012345": the same search run once on the ticket's title.
- **How to use it:**
  1. Knowledge > Insights half. If a ticket is open, look at "Articles for INC0012345" first.
  2. Under "Knowledge search" type words from the problem (up to 200 characters; at most five words are used) or an article number, and press "Search" (or Enter).
  3. Press a result to open it in a new tab, or "Copy link" to copy the link for the customer ("Link copied").
  4. If "More articles match. Add a word to narrow it down." appears, add a word.
- **Needs / privacy:**
  - No AI, no key; reads only, with your own session, so the knowledge bases you cannot read never answer. The panel keeps nothing once it closes.
  - A sensitive record whose title may not be read is not searched: "This ticket's title cannot be read here, so search with your own words below."
- **Limits:**
  - Only published articles. Email addresses, links and phone numbers in your query are ignored.
  - Zero results is not proof there is no article: the message is "No published article you can read matches ...".
  - Sometimes a read says "Still searching the knowledge base. Large bases take a moment..." after three seconds.

### Chat summary

- **What it does:** "Summarise this chat" wraps up a live chat: Summary (two to four sentences), Outcome (resolved, partly resolved, handed over, abandoned or unclear, with a reason), Follow-ups (or "None"), and "Suggested ticket notes" (at most five short lines: the issue, what was tried, the result, the next step). Uses up to the newest 60 messages. Messages from a bot are context, not the customer; it writes "Not stated" when something is missing; at most 170 words. The Ticket screen also has a no-AI "Chat facts" card for the same record: number of messages, how many from the customer, agents and a bot, "chat open" or "chat ended", how long the customer has been waiting, how long it lasted, the time to the first reply, who took part, and the customer's last message.
- **How to use it:**
  1. Open the chat record (interaction, conversation or chat queue entry) in ServiceNow.
  2. Ticket screen > AI Assist half > Resolve group > "Summarise this chat". Pass the "Check before sending" sheet.
  3. On the answer card press "Add notes to work notes" to put the "Suggested ticket notes" part into the open form's Work notes, or press Copy for the whole summary.
  4. Press Save in the form yourself.
- **Needs / privacy:**
  - An AI provider and key. Shown for the customer service and IT profiles. Feature id `chat-summary`. The chat text goes masked; each message carries the sender's name inside the text so it is masked too.
  - It needs read access to the chat message tables. Where they cannot be read the Chat facts card says "No chat messages are available to you."
- **Limits:**
  - Not verified on a real instance: which tables hold the messages (the code assumes `sys_cs_message` with `sys_cs_conversation`, or `live_message` with `live_group_profile`), who sent each message and the times (docs/live-questions/knowledge.md). If the sides cannot be told the card says "ServiceNow does not say who sent each message here, so waiting time cannot be worked out."
  - If the form does not allow Insert (for example Workspace), use Copy.

### Chat reply suggestions

- **What it does:** "Suggest replies" writes exactly three short replies (at most 40 words each) to the customer's most recent message, numbered 1 to 3 and different on purpose: (1) answers directly, using a knowledge article when one applies; (2) asks the one question that would help most; (3) a short, honest holding reply about what happens next. The replies are grounded in the last 14 messages and in up to three knowledge articles found by searching the chat's topic plus the customer's own words. They never promise a fix, a time, a refund or an outcome the data does not support, and never include passwords, codes or other people's details.
- **How to use it:**
  1. Open the chat record.
  2. Ticket screen > AI Assist half > Reply group > "Suggest replies". Pass the sheet.
  3. The answer card shows three numbered replies, each with its own "Copy this". Copy the one you want and paste it into the chat window yourself; Agent Buddy never writes into the chat window.
  4. Edit it before you send.
- **Needs / privacy:**
  - An AI provider and key. For customer service and IT profiles. Feature id `chat-reply`.
  - Because article excerpts written by other people go along, the "Check before sending" sheet is shown every time ("This one includes other tickets, so you are always asked."). If the knowledge search fails the replies are written from the chat alone, and the card says "The knowledge base could not be searched, so the replies use the chat only."
- **Limits:**
  - Copy only. The same unverified chat-table assumptions as the summary apply.
  - Three replies are a starting point: check facts in them against the article.
