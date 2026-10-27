# Agent Buddy: integration review

Scope: everything changed since `f7f7334` except the reports work (src/reports/*, src/dashboard/*, src/sidepanel/reports/*,
src/sidepanel/charts/*, ReportsView, tests/reports-*, tests/charts-*). Read against `docs/contracts.md` and `docs/build-rules.md`.

How this was checked: all code on the shared path read in full (App, RecordView, recordTabs, useRun, RunPanel, ResultView,
PendingDraft/pendingDraft, openRecord, usePage, SetupView, MyDayView, ask, the Write panels, the check/knowledge/chat tabs, the
registry and the five feature packs, the context specs, the content script and all eight ops files, the page bridge's fill/read
actions, the area CSS). Where a claim was checkable I ran a small script outside the repo (bundled with the repo's esbuild; nothing
under src/, tests/ or e2e/ was touched) and `node tests/run.js` (1387 tests, all pass, so none of the problems below is caught by
the suite). I did not run `build.js` or the e2e harness, and I could not use a real instance or browser. Items that depend on
ServiceNow or on browser timing are marked **unconfirmed**.

Severity: High = breaks a main flow or loses/mangles a person's text, or breaks a non-negotiable rule. Medium = real defect with a
workaround or a narrow trigger. Low = polish, consistency, latent risk.

## Findings at a glance

| Id | Sev | Where | One line |
|---|---|---|---|
| H1 | High | App.jsx, usePage.js | Write and Knowledge lose all typed text and drafts whenever the active tab is not a ServiceNow page (and, likely, on every navigation) |
| H2 | High | compose/rewrite.js, Rewrite and Notes panels | Rewrite and Notes to ticket bypass `blockedTables`, `blockedFields` and the HR gate (proved with a script) |
| M1 | Medium | ResultView.jsx, compose/shared.js, SnippetsPanel | No guard against a double click or a second click: "append" inserts the text twice |
| M2 | Medium | RewritePanel, EmailPanel, shared.js | "Replace what is in the form" (the primary button) writes to whichever form is open now, not the record the text came from |
| M3 | Medium | checks/resolutionCheck.js | Check tab says "No messages" and "No personal data spotted" when the notes could not be read (proved) |
| M4 | Medium | knowledge/DuplicatesPanel.jsx | Compare race: a late answer attaches the wrong articles to the merge draft |
| M5 | Medium | RecordView.jsx | Header title reads "Loading…" forever when the header read is denied, empty or the record has no short description |
| M6 | Medium | packs/core.js, packs/itsm.js | Features offered on `request` records that cannot do what they promise (proved) |
| M7 | Medium (unconfirmed) | packs/itsm.js, bridge fill | Article body goes into an HTML field as plain text: line breaks and `<`/`&` mangled |
| M8 | Medium | ResultView.jsx:125 | "Edit first (copy instead)" copies the whole answer, not the part that was about to be inserted |
| M9 | Medium | sidepanel/index.jsx | No error boundary: one render error in any of the 13 new views blanks the whole panel |
| M10 | Medium | App, RecordView, KnowledgeToolsView | Three tablists have tab roles but no keyboard behaviour or tabpanels (the Write section does it right) |
| M11 | Medium | ask.js, useRun.js | Browser-level error text reaches the person |
| L1-L17 | Low | various | see below |
| T1-T5 | Tests | tests/ | a corrupted helper in a leak test, view tests that only render once, no tests or e2e for the shared plumbing |

---

## High

### H1. Write and Knowledge lose everything the person typed when the active tab stops being a ServiceNow page

- Where: `src/sidepanel/App.jsx:72-98`, `src/sidepanel/usePage.js:34-45`, consequences in `src/sidepanel/tabs/ComposeView.jsx`,
  `src/sidepanel/compose/*`, `src/sidepanel/tabs/KnowledgeToolsView.jsx`.
- What is wrong: `App` renders a section only while `page.status` is `record` or `no-record` (`enabled`). `usePage` returns
  `not-enabled` whenever `chrome.tabs.sendMessage(PAGE_STATE)` rejects, which is what happens on any tab without the content
  script. The moment that happens `Other` is false, `SetupView` is rendered instead, and `ComposeView` (with its four "stay mounted"
  panels) is unmounted. Every `useState` in it is destroyed: the Rewrite textarea, the Notes textarea and the reviewed proposal,
  the "names to hide" boxes, the email draft and its `target`, a half-written snippet in the editor, the Duplicates/Gaps results.
  The comment in `ComposeView.jsx` ("a draft, a pasted text or a half-written snippet survives") and the test comment at
  `tests/compose-view.test.js:36` are only true for switching between the four sub-tabs.
- Steps (certain, from the code): Write > Rewrite, paste a paragraph. Click any other browser tab (a mail client, a wiki) to copy
  something. The panel shows "Not turned on for this page" (or the setup card). Click back to the ServiceNow tab. Rewrite is empty.
  Same for "Rough notes from the call" after typing a long note.
- Likely worse, **unconfirmed (browser timing)**: a classic ServiceNow page load is a full navigation. During it
  `sendMessage` to the old/new page rejects, so `status` flips to `not-enabled` for roughly one poll. That is exactly the flow the
  Write section is designed around: "Open the email form" (`EmailPanel.jsx:48-53`; the comment at `EmailPanel.jsx:85` says the draft
  is kept), "Open a new incident form" from Notes to ticket, and saving a record. If the flip happens, the draft/review state is
  gone when the new page arrives, and for Notes the only thing left is the `PendingDraft` card, which has Copy only (see L1).
- Fix: do not unmount. Either keep the visited sections mounted and hidden (`display:none`, as ComposeView already does for its
  sub-panels) and give them the last good `page` plus a one-line "This tab is not a ServiceNow page" banner while `status` is not
  enabled, or move the drafts (texts, names, results) into an in-memory module store like `pendingDraft.js` (memory only, so
  build rule 7 still holds). Add one e2e step: type in Rewrite, activate a non-ServiceNow tab, come back, text still there.

### H2. Rewrite and Notes to ticket skip three policy rules because their pack is labelled `table: 'compose'`

- Where: `src/compose/rewrite.js:97-111` (`buildComposePack`: `table: 'compose'`, part field `'text'`/`'notes'`),
  `src/sidepanel/compose/RewritePanel.jsx:55-60`, `NotesPanel.jsx:52`; rules in `src/lib/pipeline.js:58-60` and
  `src/pii/firewall.js:226-238`.
- What is wrong: `assertRunnable` checks `isTableAllowed(pack.table)` and `isHrTable(pack.table)`; the firewall checks
  `blockedFields` against `part.field` and its Strict-mode HR free-text rule against `table`. With a made-up table and field name
  none of the three can ever fire. Rewrite even offers to pull text out of the open form ("Use what I typed in the form"), so on an
  HR case it will happily send the form's description to the model.
- Proved with a script (policy `blockedTables: ['sn_hr_core_case','incident']`, `blockedFields: ['comments','close_notes']`,
  `allowHrContent: false`, Strict mode): `prepareRun` succeeded for `rewrite-short` and `notes-to-ticket` and produced the
  outgoing message; the same policy refused an incident pack with "Your organisation does not allow Agent Buddy to use incident
  records." Build rules 8 and 11 ("Policy wins", HR content blocked unless allowed) are not met.
- Steps: set the managed policy above, open an HR case, Write > Rewrite > "Use what I typed in the form" (target Description),
  press "Shorter". The preview appears and the text goes out.
- Fix: when `page.record` exists build the pack with that record's table (`buildComposePack({ table: page.record?.table ||
  'compose', ... })`, keep `sysId` synthetic) so the table, HR and Strict rules apply; set the Rewrite part's `field` to the form
  field it came from (`comments`, `work_notes`, `close_notes`, `description`, `short_description`) so `blockedFields` applies; refuse
  "Use what I typed in the form" on an HR table without `allowHrContent`. Add a pipeline test with a compose pack and a blocking
  policy. Decide and document what pasted text with no open record should do (probably allowed, as now).

---

## Medium

### M1. A double click, or a second deliberate click, inserts the text twice

- Where: `src/sidepanel/ResultView.jsx:71-107` (`insert`), `src/sidepanel/compose/shared.js:100-126` (`useFill.insert`),
  `src/sidepanel/compose/SnippetsPanel.jsx:175-187`, `EmailPanel.jsx:60`. `NotesPanel` has a `filling` guard; the others do not.
- What is wrong: `ResultView` always sends `mode: 'append'` (line 97) and nothing disables the button while the message is in
  flight or after it succeeded. Two clicks run two `appendBelow()` calls in the page, giving "text\n\ntext" in a work note or,
  worse, a customer comment. The success note ("Inserted into the form") invites a second click.
- Steps: any result > "Add to work notes" > double click (or click again to be sure) > the field holds the text twice.
- Fix: an `inserting` flag that disables every insert button during the call, and after success mark that spec as done
  (button text "Inserted", disabled) until Try again or Close. Same in `useFill`.

### M2. "Replace what is in the form" acts on whichever form is open now

- Where: `src/sidepanel/compose/RewritePanel.jsx:81,147-152`, `EmailPanel.jsx` (DraftActions), `shared.js:35-42` (`fillField` sends to
  `page.tabId` as it is at click time).
- What is wrong: nothing remembers which record the text was read from or the rewrite was made for. Replace is the primary
  (blue) button and overwrites the field, unsaved text included, with no way back.
- Steps: ticket INC1, Rewrite, "Use what I typed in the form", run Shorter. Switch to the INC2 tab (the Rewrite result stays, the
  panel does not reset on a record change). Press "Replace what is in the form": INC2's Additional comments is replaced.
- Fix: store `{ table, sysId }` with the text/result; if `page.record` differs at click time, disable the buttons and say "This
  came from INC0010001". Name the record in "Goes into: ...". Make "Add below" the primary action, or read the old value first and
  offer "Put it back".

### M3. The Check tab reports reassuring facts it does not know

- Where: `src/checks/resolutionCheck.js:119-123` (`customerCheck`), `:194-220` (`piiCheck`). `childCheck` reads `pack.access`;
  these two do not.
- What is wrong: when the notes could not be read (`access` entry `journal` = `denied` or `empty-or-hidden`, which the context
  engine does emit: `src/context/journal.js:202-212`) the journal is `[]`, so the tab says "No messages to or from the customer on
  this ticket" and "No personal data or secrets spotted in the text". Build rule 9 says a 403 must be shown as such.
- Proved: `buildCheckView` on an incident pack with `access: [{source:'journal', status:'denied'}]` returns exactly those two
  statements (plus "No problem or article is linked").
- Fix: read the journal access entry in both checks; when it is not `ok`/`empty` return an `info` check "Could not read the notes
  and comments" with the access note, and do not say "nothing spotted". Same idea for `linkCheck` when the form was not readable.
  Add a test with a denied journal.

### M4. Duplicates: a late "Compare" answer attaches the wrong articles

- Where: `src/sidepanel/knowledge/DuplicatesPanel.jsx:66-96` (`pick`, `toggle`, `compare`).
- What is wrong: `compare()` has no token. While it is reading, the checkboxes and "Compare" on other groups stay usable;
  `toggle()` and `pick()` replace `picked`, and when the read resolves `setPicked((p) => p ? { ...p, phase: 'compared', texts } : p)`
  puts the old answer on whatever `picked` is now. The merge button then runs `mergePack(picked.texts.articles, ...)` for articles
  that are not the ones ticked on screen.
- Steps: group A, Compare. Before the answer arrives, click Compare on group B (or untick one article of A). The panel shows B's
  (or the 2-box) selection with A's texts and "Draft a merged article" merges A.
- Fix: keep a request counter like `find()`, apply the answer only if it still matches the current cluster id and selected ids;
  disable checkboxes and other Compare buttons while `phase === 'loading'`.

### M5. "Loading…" never goes away on the record header

- Where: `src/sidepanel/RecordView.jsx:27-29,47`.
- What is wrong: a rejected header read is swallowed (`.catch(() => {})`) and `header?.short_description || 'Loading…'` shows the
  placeholder for both an error and a blank value. A denied header, an ACL that returns a row with empty columns (HTTP 200), or a
  record with no short description (it can be blank on chat/`interaction` records, which this change adds) shows "Loading…" for good.
- Fix: track `loading | ready | failed`; failed shows the number plus "Details are not available to you."; blank title shows "(no
  short description)".

### M6. Features on the Actions list that cannot do what they say for a kind

Found by listing each feature's spec columns for each of its kinds with a throwaway script run against the real registry and
`src/context/allowlists.js` (`src/features/packs/*`):

- `routing-hint` is offered on `request` (itsm.js:116). The `request` ceiling has no `category` and no `assignment_group`, so the
  pack has neither (a request is routed through its items, not itself), and the answer will be "Not enough information" for
  category and group. The pack also lacks `category` on `requested_item` and `task`. Fix: drop `request` from its kinds (keep
  `incident`, `case`; decide for `requested_item`/`task`).
- `resolution-notes` is offered on `request` (core.js:55) but the `request` ceiling has no `close_notes`, and the insert goes to
  `close_notes`. **unconfirmed:** whether the `sc_request` form has that field. Fix: drop `request` or add the column with a reason.
- `request-explain` (checks.js:19) inserts into `comments` of the open form; on a **catalog task** the requester usually reads the
  requested item (RITM), not the task. **unconfirmed.** Consider inserting only on `request`/`requested_item`, or say "This goes
  into the task's comments" next to the button.
- `wave` is read nowhere in src; tests that assert it prove nothing about behaviour. Drop it from the contract or use it.

Checked and fine: 38 unique ids, every `context` id has a spec, a journal flag and a related list, no feature reads notes while its
spec says it does not, all kinds named exist in the ceiling table.

### M7. (unconfirmed) Article body is inserted into an HTML field as plain text

- Where: `src/features/packs/itsm.js:155-159` (`short_description`, `text` inserts), `src/page/bridge.js` `fillField`
  (`g_form.setValue(name, text)`), already open as question 11 in `docs/live-questions/itsm.md`.
- Why it matters: `kb_knowledge.text` is an HTML field. Newlines collapse, numbered steps run together, and text such as
  "Type <your-user-id> in the box" or "A & B" is parsed as markup and loses characters. That is mangling a person's text.
- Fix before release: make the body insert Copy-only until it is verified, or have the bridge detect an HTML field (`fieldType`)
  and convert `\n` to `<br>`/`<p>` and escape `& < >` first. Needs a live check on classic and the Knowledge workspace.

### M8. "Edit first (copy instead)" copies the wrong text

- Where: `src/sidepanel/ResultView.jsx:125` (`copy('Not inserted.')` uses the default `value = plain`).
- What is wrong: after a safe-to-send warning on a part (for example the article body with `pick`), the copy puts the entire
  answer (title, symptoms, ...) on the clipboard, not the part the person was inserting. The Write panels get this right
  (`shared.js:159`).
- Fix: keep `value` in the `findings` state and copy it.

### M9. No error boundary

- Where: `src/sidepanel/index.jsx:4`; nothing in src defines one.
- What is wrong: any exception during render in any of the new views (a null that nobody expected in a pack or an op answer) unmounts
  the whole React tree: a white panel, no Settings button, no message.
- Fix: one small class boundary around each section and one around `App`, with "Something went wrong in this part of Agent Buddy.
  Reload the panel." and an Open Settings button.

### M10. Three tablists with tab roles but no tab behaviour

- Where: `src/sidepanel/App.jsx:81` ("Agent Buddy sections"), `RecordView.jsx:61` ("Panel sections"),
  `tabs/KnowledgeToolsView.jsx:25`.
- What is wrong: `role="tablist"`/`role="tab"` promises arrow-key movement, one tab stop and a `tabpanel`. These have every tab in the
  tab order, no arrow keys, no `aria-controls`, no panel role. `ComposeView.jsx` implements the pattern correctly, so the panel is
  inconsistent, and a screen reader announces two nested tab lists with confusing names.
- Fix: share ComposeView's tab component, or drop the roles and use a `<nav aria-label>` with `aria-current="page"` buttons.

### M11. Browser-level error text reaches the person

- Where: `src/sidepanel/ask.js:4-12` (passes through `chrome.tabs.sendMessage` rejections), `useRun.js:54-57` (`fail`), and every
  `err.message` in the new views.
- What is wrong: after an extension reload, or on a tab that was open before the site was turned on, the content script is gone and
  the person sees "Could not establish connection. Receiving end does not exist." or "The message port closed before a response was
  received." Not plain, not kind, not actionable.
- Fix: in `ask()` map those two messages (and a missing tab) to "Agent Buddy lost touch with this page. Reload the ServiceNow page
  and try again." Also `ResultView.jsx:78` says "a kb_knowledge form"; say "a knowledge article form".

---

## Low

- **L1. Notes to ticket: duplicated and weaker second path.** `NotesPanel` renders `RunPanel`, so the generic result card offers
  "Open a new incident form" (`ResultView.jsx:134-146`, because the feature has `open`). That stores a `PendingDraft` and navigates.
  The draft card on the blank form has no insert (the feature has no `insert`), only Copy, and stays up to an hour on every blank
  incident form until Close. The panel's own "Fill the form" is the real flow. Remove `open` from `notes-to-ticket` (the panel
  already knows the form) or give the draft card a way to fill. `openNewRecord`/`openRecord` return `false` when the address cannot
  be built and callers ignore it, so the button can do nothing silently (`ResultView.jsx:141`, `DuplicatesPanel`, `GapsPanel`).
- **L2. "Cancel" does not cancel.** `RunPanel.jsx:20` calls `reset()`, which only drops the answer. `sendChat` has no abort
  (`src/providers/index.js`), so the request still goes out and is audited as `sent`. Label it "Stop waiting" or add an
  `AbortController` through `sendChat`.
- **L3. A single-line field is appended to.** `ResultView.jsx:97` always sends `append`, so "Insert title into the article form" on
  a form with a title, or pressed twice, gives "Title\n\nTitle" in `short_description`. Let an insert spec say `mode: 'replace'` for
  one-line fields.
- **L4. PreviewDialog.** `PreviewDialog.jsx:25-31`: the effect depends on `onCancel`, which is a new function on every render
  (`run.cancelPreview`), so "Send to AI" regains focus on each parent re-render; the Escape listener is on `window`, so a preview
  waiting inside a hidden Write sub-panel is cancelled (and audited) by Escape pressed anywhere. Memoise the handlers, bind Escape
  to the dialog, and make the background inert (`aria-modal` alone does not trap Tab).
- **L5. Four copies of "is AI ready".** `RecordView.jsx:19`, `KnowledgeToolsView.jsx:20`, `compose/shared.js:10` accept an `ollama`
  provider; `SetupView.jsx:11` does not (an Ollama user still sees "Add an AI key"); none honours `config.keyOptional`, which
  `assertRunnable` does, so a custom localhost server (LM Studio) shows every button disabled. One helper from
  `resolveProviderConfig`.
- **L6. `reads.js:18` falls back to `record-summary`** when `args.feature` is unknown. The context engine fails closed; this hides a
  mistyped spec id behind a different allowlist. Throw instead.
- **L7. Internal names in plain text.** `knowledge/Notes.jsx:9` prints `kb_use: ...`, `m2m_kb_task: ...` (a test pins this). A
  fulfiller cannot act on a table name; translate sources to words ("article links").
- **L8. `keepMasked` placeholders can be inserted.** `kb-article-draft` may return `[PERSON_1]` despite the prompt; the check in
  `ResultView` looks for serious data only, not leftover placeholders. Warn when the picked text matches `\[[A-Z_]+_\d+\]`.
- **L9. Empty model answer** (`executeRun`: `reply.content || ''`) shows an empty card titled with the feature. Treat it as an
  error: "The AI sent back nothing. Try again."
- **L10. Notes to ticket on a case form.** `planFill` adds `impact` and `urgency` for any incident/case blank form
  (`notesToTicket.js:190-191`); live question 15 expects a case form to lack them, so every case fill ends with "Not filled:
  Impact (...), Urgency (...)". Skip them for `case`. Likewise `formValues` returns `available: true` with no key for a field the form
  does not have, and Rewrite says "The ... field is empty".
- **L11. Logic that must agree lives twice.** `seriousFindings` is in `ResultView.jsx:30-42` and `compose/sendCheck.js`; the
  customer-visible sets are `ResultView.jsx:20` (`comments`, `close_notes`, `text`) and `compose/formFields.js` (adds `description`,
  `short_description`). Import one of each.
- **L12. Checklist ticks are a new kind of stored data** (`checks/checklistStore.js`: record sys_id plus 8-hex hashes of step text,
  200 records, no expiry). Build rule 7 lists what storage may hold; the author declared the exception in the file header. Lead to
  accept or reject it explicitly (a short FNV hash of a short step is guessable). "Clear ticks" has no confirmation.
- **L13. Navigation leaves the page.** `openRecord`/`openNewRecord` always use `chrome.tabs.update` on the current tab, and for a
  Workspace page the address is the classic `nav_to.do` (contrary to "the kind of page the agent is already using"). Lists in My
  day, Gaps, Duplicates and Related replace the ticket the person is working on (the browser may ask about unsaved changes). Say so
  on the button ("Opens in this tab") or offer a new tab.
- **L14. Small accessibility items.** `.ab-compose-picked` shows the selected snippet by border/background only (it does carry
  `aria-pressed`); `ResultView` puts `role="alert"` inside an `aria-live` region (double announcement); opening the snippet editor
  or the notes review does not move focus; `ab-feature:disabled` at 55% opacity is below AA for the descriptions (disabled text is
  exempt, but the reason is not given next to the button in the Chat tab).
- **L15. A preview per feature.** "Check what will be sent" defaults to once per feature id, and the Write section adds 14 ids (6
  emails, 7 rewrite presets, notes). A new user meets 14 first-time dialogs for what feels like three tools. Consider "first time
  per tool" for the generated groups.
- **L16. Audit detail.** `compose/shared.js:77` logs `eff.values.models[provider]` (empty when the default model is used) where
  `RunPanel` logs the resolved `config.model`; drafts inserted from `PendingDraft` are not audited (`audit={() => {}}`).

- **L17. An out-of-ceiling read with no test.** `src/content/ops/itsm.js` (`EXTRA_COLUMNS`) asks the look-alike tickets' table for
  `assignment_group`, `priority` and `subcategory` from its own list, not from a context spec. On `request`, `requested_item` and
  `task` some of those are outside `FIELDS_BY_KIND` (for example `subcategory`). Build rule 8 says the ceiling is the contract; the
  knowledge area proves the same property for its bulk read in `tests/knowledge-context.test.js:44`, the ITSM area has no such test.
  Add the same assertion, or limit the extra read to the kinds whose ceiling has the columns.

### Unconfirmed, worth a live check

- `src/context/chat.js` `messageSide`: `/\b(bot|virtual|automated)\b/` does not match `virtual_agent` or `chat_bot` (underscore is a
  word character), so such messages get side `''`.
- `knowledge/articleChecks.js`: an empty `text` is reported as the problem "No text" when the column is hidden by a field ACL or
  the article is a wiki article whose type column is empty. The access list cannot tell these apart.
- Whether `sn_customerservice_case` really lacks impact/urgency and `problem` has an "Additional comments" field for
  `reply-draft` (L10, core.js).

---

## Tests

- **T1. A broken helper in a security test.** `tests/itsm-run.test.js:49` reads
  `const escapeRegex = (s) => s.replace(/[.*+?^${}()|[]\]/g, '\const outgoing = (prepared) =>');` (an editing tool expanded `$&`
  into the neighbouring text). It escapes nothing, so `has(text, secret)` treats each seeded secret as a regular expression. The
  tests pass today only because none of the current `SEEDED` values contains `+ ( ) ? [`; the first one that does will throw or
  silently weaken "nothing personal leaves". Restore `'\\$&'` and the lost line. I checked the other escape helpers in src
  (`itsm/sections.js`, `domain/sections.js`, `knowledge/sections.js`, `safeSend/index.js`, `reports/exportTables.js`): intact.
  The hazard to watch for is any `$&`, `$1` or `` $` `` in text pushed through a replace-style edit.
- **T2. View tests prove only the first render.** `tests/compose-view.test.js` and `tests/knowledge-views.test.js` use
  `renderToStaticMarkup`, so no effect, no click and no state change runs. The line "hidden, so their drafts survive a look at
  another tab" (compose-view.test.js:36) is asserted by counting `hidden=""` attributes. It does not test survival, and H1 shows the
  survival does not hold across sections.
- **T3. A test named for something it does not test.** `tests/checks-features.test.js:51` ("customer-visible fields are the ones
  ResultView checks first") only compares insert field names; it never touches `ResultView` or its `CUSTOMER_VISIBLE` set.
- **T4. No tests at all for the shared plumbing:** `useRun` (token invalidation, cancel, preview confirm/cancel, again, error
  paths), `ResultView.insert` (table refusal, pick, safe-to-send, copy fallback), `pendingDraft.js`/`PendingDraft`, `App` section
  routing, `usePage`, `RecordView` per-record reset, `DuplicatesPanel` compare. The e2e harness has no scenario for Write, Knowledge,
  Request, Check, Checklist, Article or Chat; only `j-panel-state` covers the old Actions flow. A small
  `react-test-renderer`/jsdom harness with a fake `chrome` would cover most of H1, M1, M2, M4 and M5 (neither package is installed
  today). Pure-logic modules are well covered; that is where the 1387 tests are.
- **T5.** No test runs a feature through `prepareRun` with a compose pack and a blocking policy (H2), and none asserts that Check
  does not claim "nothing found" for an unreadable journal (M3).

---

## Checked and found sound

- **Registry.** 38 feature ids are unique; spec/journal/related/limits/fieldsByKind keys do not collide between the six spec files
  (the `Object.assign` merge would have silently overridden); every feature's `context` resolves; all `kinds` exist in the ceiling.
- **Ops wiring.** The 14 op names in `src/content/ops/*` are unique and none shadows the built-ins in `reads.js` (which also uses an
  own-property check). Arguments are validated (identifiers, sys_ids, bounded numbers, name lists), the page bridge has a 2.5 s
  timeout on every call, every thrown error is returned as a wire error, so nothing leaves the panel spinning from the content
  script. The two form-reading ops are separate and both treat the page's answer as untrusted data; the checks one also verifies the
  form is the record on screen.
- **Pick helpers vs prompts.** With realistic answers (plain labels, `**bold**` labels, `##` headings, bulleted sections, a
  leading "Similar article exists:" line, "Hypothesis:" inside Probable cause, Not stated sections) the four pickers return the
  right part; empty sections give '' and ResultView says there is nothing to insert. Chat-summary falls back to the whole text.
- **Pipeline.** Every feature prepares through the real firewall in Standard and Strict mode with a fully populated pack (the only
  refusal is `hr-case-brief` in Standard, by design); every `parts()` survives rows with missing fields; `logAudit` cannot throw.
- **Security rules in the new panel code.** No `innerHTML`, `eval`, `target=_blank`, `fetch`, or page-button clicks; every write
  goes through `FILL_FIELD`; model output is rendered through `SafeText`; `openUrl` refuses any other origin; no emoji in UI text.
- **Per-area behaviour.** Request, Chat, Duplicates, Gaps and Article tabs say what could not be read instead of showing an empty
  list; `useLoader` token logic and `checklistStore` serialisation are correct; `SnippetsPanel`/`EmailPanel` effects have the right
  dependencies and race guards; hooks are never called conditionally; the record-change reset in `RecordView` and the late-answer
  drop in `useRun` work (also covered by e2e scenario j).
- **CSS.** No hard-coded colours or comma-layered backgrounds in `ui.css` or the area files; every `var(--ab-*)` token exists (the
  one `--ab-canvas` is in a comment); all static class names used by the new views have a rule; rows wrap at 320 px; state words
  are always written out (colour only backs them up); focus ring is global; the Write tablist has roving tabindex, arrow keys, Home
  and End, and labelled panels; every form control in the Write section has a label.
- **Tests.** The full suite passes (1387).
