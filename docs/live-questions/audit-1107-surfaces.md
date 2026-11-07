# Workspaces and the other surfaces: what was assumed (audit of 2026-11-07, part 9, S1 to S23; the live checks L1 to L15 of that audit, consolidated)

Area: how Agent Buddy behaves on the classic UI, the Next Experience shell, Workspaces and portals. Workspaces were the worst served
surface: the whole write side rests on guessed labels and on a page nobody has looked at. Everything built keeps an unknown as an
unknown (see "How it behaves until you answer"), so none of this blocks. Run the lines in the console of an already signed-in ServiceNow
tab, as a fulfiller (not an admin) on a development site, in the top frame (Workspaces are top-level pages). Every line prints the
shape of the page (tag names, labels, types, counts), never ticket text. Do not paste ticket text into a report.

Where the rules are: the page bridge `src/page/bridge.js` (`findControls`, `chooseWorkspaceControl`, `LABEL_SETS`, `readComposerMode`,
`watchInsert`, `frameIsOnList`); the panel `src/sidepanel/insertFlow.js` (`applyFieldStates`, `recheckDelay`) and
`src/sidepanel/ticket/assist/answers/AnswerCard.jsx`; the content script `src/content/index.js` (what counts as a save),
`src/content/saveLabels.js`, `src/content/ops/compose.js` (`readBoxes`), `src/content/dialogs.js`. Tests: `tests/workspace-*.test.js`;
the browser: `e2e/scenarios/zu-workspace.js` and the Workspace step of `e2e/firefox/run.js`, against the fake in `e2e/site/`.

## How it behaves until you answer

- Insert on a Workspace or portal page: before the click the panel asks the page whether the box is there. Found: Insert is offered.
  Not found, two look-alikes, or the page too big to search in the time allowed: Insert is off, Copy leads, and one plain line says
  why ("This page's box can't be filled automatically. Copy and paste."). The page is looked at again every 5 seconds (every 20 for a
  page too big to search) while that is so, so opening the Notes tab or switching the composer is noticed without a click.
- A composer that serves Work notes and customer comments: the switch is read, never changed. Set to the kind of the text: Insert. Set
  to the other kind: Insert is off and the line says which way to switch. Not readable: the text still goes in, and the note after it
  says "Check the box says Work notes before you post." for a work note (a customer reply was reviewed for the customer, so it is safe
  in either mode and gets no extra line).
- Undo is withdrawn after anything that looks like a save: a press of a button whose label has Save, Update, Resolve, Submit, Post,
  Send, Publish, Apply (or Close with what it closes, or Mark complete), in English or Arabic; Ctrl+S or Ctrl+Enter; and, with no
  label at all, the box the insert wrote to being emptied or taken off the page. Undo still restores only a box that holds exactly what
  the insert left.
- No button of the page is ever pressed by Agent Buddy (build rule 1). The e2e presses Post and Save itself, as a hand would.

## A. Finding the box (S4, S5, S18)

1. **L1. The labels.** Assumed: the Workspace composer and form boxes carry the exact English labels "Additional comments", "Work
   notes", "Resolution notes", "Short description" (also "Customer comments", "Close notes"), and the Arabic labels in
   `LABEL_SETS` (bridge.js; written from the Arabic language pack as it is believed to read).
   Check, on a Service Operations Workspace and a CSM Workspace incident, with the Notes tab visible:
   `(function w(r,o){r.querySelectorAll('*').forEach(e=>{if(e.shadowRoot)w(e.shadowRoot,o);if(e.tagName==='TEXTAREA'||(e.tagName==='INPUT'&&(e.type||'text')==='text')||e.getAttribute('contenteditable')!==null)o.push([e.tagName,e.getAttribute('aria-label'),e.name||e.id||'',e.getClientRects().length>0])});return o})(document,[])`
   then `console.table` it. Is there exactly one visible row per label?
   If a label differs: add it to `LABEL_SETS`. Until then the box is "not found" and Copy leads.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (in part: the Workspace composer boxes are name=work_notes (aria-label "Work notes") and name=comments (aria-label "Comments"), found by their name; the other labels were not listed).
2. **L2. The size.** Assumed: a record page is well under a million elements and is searched in under a second. The old cap was 25,000.
   Check: `(function c(r){let n=0;r.querySelectorAll('*').forEach(e=>{n++;if(e.shadowRoot)n+=c(e.shadowRoot)});return n})(document)` and then
   `performance.now()` before and after `(function c(r){r.querySelectorAll('*').forEach(e=>{if(e.shadowRoot)c(e.shadowRoot)})})(document)`.
   If the walk takes more than about 0.5 s: raise `SEARCH_BUDGET_MS` in bridge.js (the panel's request waits 2.5 s for the page).
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (2,008 nodes in 462 shadow roots on a Workspace record; a full search takes 7 ms).
3. **L12. Arabic.** Set the test user's language to Arabic and run L1 and L7 again. Assumed: labels and buttons are in Arabic and nothing
   is in English. If a Workspace keeps English labels in Arabic, nothing changes. If the Arabic words differ from `LABEL_SETS`,
   `MODE_INTERNAL`, `MODE_CUSTOMER` (bridge.js) or `saveLabels.js`, add them.

## B. The composer's mode (W-12, S14)

4. **L13. One box or two.** Assumed: the composer is one box with a switch (tabs, radio buttons, a menu) and the box may keep one label
   whatever the switch says. Check, on a Workspace incident: run L1 with the composer on "Customer comments" and again on "Work notes";
   does the visible box's `aria-label` change? Then print the switch:
   `(function w(r,o){r.querySelectorAll('*').forEach(e=>{if(e.shadowRoot)w(e.shadowRoot,o);const s=e.getAttribute('aria-selected')||e.getAttribute('aria-checked')||e.getAttribute('aria-pressed')||e.getAttribute('aria-current');if(s==='true')o.push([e.tagName,e.getAttribute('role'),(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,30)])});return o})(document,[])`
   Assumed: the chosen mode shows up there with the words Work notes / Customer comments, and the activity stream's filter (All,
   Comments, Work notes...) is a separate group that also has "All".
   If the box's label follows the switch: nothing to change (the wrong mode is "not found", and Copy leads).
   If the switch is not marked with ARIA (a CSS class only): the mode stays "cannot tell", the caution stays, and a work note carries
   "Check the box says Work notes before you post." Add the real marker to `selectedChoiceText` (bridge.js).
   If the stream filter is inside the composer's own group: the exclusion in `readComposerMode` (`MODE_FILTER`) is the place to change.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (two boxes, only the selected one visible (the other is 0 by 0); the tab "Work notes" has aria-selected).

## C. Saving and Undo (S6, S20)

5. **L7. The buttons.** Assumed: the record Save is called Save or Update, the composer's button Post, and a portal's Send.
   Check: `(function w(r,o){r.querySelectorAll('*').forEach(e=>{if(e.shadowRoot)w(e.shadowRoot,o);const t=e.tagName.toLowerCase();if(t==='button'||e.getAttribute('role')==='button'||t.startsWith('now-button'))o.add((e.getAttribute('aria-label')||e.getAttribute('label')||e.textContent||'').replace(/\s+/g,' ').trim().slice(0,40))});return[...o]})(document,new Set())`
   on a record in each Workspace (English and Arabic). If a button that saves is not matched by `saveLabels.js`, add its word. Missed
   presses are caught anyway when the composer empties; a form field that keeps its text after a save is the case that needs the word.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (the buttons are "Post Work notes", "Post Comments", "Save" and "Resolve").
6. **Does a Post empty the composer, or re-draw it?** Assumed: either. Check: type a few words in Work notes, press Post (on a test
   ticket), look at the box. If it keeps the text (a composer that clears late), Undo is withdrawn at the press of Post instead
   (by the label), not at the emptying.
7. **L8. A dirty form and a link.** Type a few words in Work notes (do not save). In the panel click a ticket row in My work (a plain
   click). Does the page or the browser ask "Leave site?" On classic, Next Experience and a Workspace. If not: every same-tab open from the
   panel loses typed text; the builder of the links (S2) decides the guard.

## D. Records, frames and routes (S7, S8, S17)

8. **L3. The route.** Assumed: every Workspace record page has `/record/<table>/<sys_id>` in its path.
   Check `location.pathname` on a record opened from a list, from the inbox or side preview, from global search, in a sub-tab, in CSM, HR
   and any scoped Workspace. Also `/now/cwf/agent/record/...` and `/now/workspace/agent/record/...` (the e2e serves both).
9. **L4. Other frames.** `[...Array(window.length).keys()].map(i=>{try{const f=window.frames[i];return[i,f.location.pathname,typeof f.g_form,f.g_form&&f.g_form.getTableName&&f.g_form.getTableName()]}catch(e){return[i,'cross-origin']}})`
   on the Polaris home, a Workspace home, a Workspace record, a record with two Next Experience tabs. Assumed: only the form's own
   frame has a g_form.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (in part: a Workspace has no frames; the classic home page has one inner frame).
10. **L5. Named access to the form frame.** On `/now/nav/ui/classic/params/target/incident.do...`:
    `[typeof window.frames['gsft_main'], typeof window.frames['gsft_main'].g_form, !!document.getElementById('gsft_main')]`, in Chrome,
    Edge and Firefox. Assumed: the frame is reached by name even when it sits inside a shadow root (the e2e builds exactly that). If
    not: the panel finds the ticket from the address and fills through the page (the DOM path) instead of g_form.
11. **L11. UI16 follows its frame?** Where UI16 is still on: open a form through `nav_to.do`, then click Incident > All. Does the address
    change? If it does not: the bridge's `frameIsOnList` already answers "no ticket is open" when the frame's own address ends in
    `_list.do`; if the list address looks different, change that pattern.
12. **L6. The token.** `[typeof g_ck, typeof g_user, typeof g_form, typeof NOW]` on a Workspace record. Assumed: `g_ck` exists, `g_form` does not.
    Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (no g_form and no g_user on a Workspace; NOW.user has only userID and isImpersonating).

## E. Links and articles (S1, S9, S10, S22; built elsewhere, still to be checked here)

13. **L9. Article views.** `https://<site>/kb_view.do?sysparm_article=<KB number>`: note the final address; then
    `/nav_to.do?uri=kb_knowledge.do%3Fsys_id%3D<id>`; then open the same article from a Workspace's Knowledge area and read the address.
14. **L10. The email form.** On a Next Experience incident press the form's Email action; read the address bar. Is it
    `/now/nav/ui/classic/params/target/email_client.do...`?
15. **L14. Other tables on a Workspace route.** In SOW open `/now/sow/record/sn_customerservice_case/<id>`; in the CSM Workspace
    `/now/cwf/agent/record/incident/<id>`. Does a ticket render?
16. **L15. `kb_view.do` as a ticket.** Open `/kb_view.do?sysparm_article=<KB>` and `/kb?id=kb_article_view&sysparm_article=<KB>`; compare with L9.

## F. The dock and other small things (S13, S15, S16, S19)

17. **Dialogs in shadow roots.** Open any dialog in a Workspace (an approval, a reassign). Assumed: it carries `aria-modal="true"` or is a
    `dialog[open]`, sits in a shadow root, and takes the focus. Check: `(function w(r,o){r.querySelectorAll('*').forEach(e=>{if(e.shadowRoot)w(e.shadowRoot,o);if(e.matches('[aria-modal="true"],dialog[open],[role=dialog]'))o.push([e.tagName,e.getAttribute('role'),e.getAttribute('aria-modal')])});return o})(document,[])`.
    If the dialog has none of these, the dock stays over it (as before); add the marker to `DIALOG_SELECTOR` (src/content/dialogs.js).
18. **Impact, Urgency, Contact type on a Workspace blank form.** Assumed: lists (choice components), not text boxes. Check
    `document` deep for `[aria-label="Impact"]` and print its tag and `role`. They are now picked by hand on a page without g_form ("Agent
    Buddy does not pick from a list on this page."). If one is a plain text box on some Workspace, remove it from `PICK_BY_HAND`.
19. **Typed text of the Write panels on a Workspace.** "Check my comment" and Rewrite now read the boxes found as an insert finds
    them. Check on a Workspace incident with some words typed in Additional comments that the panel takes them; with nothing typed it says
    the field is empty; with the box missing it says it cannot read the page and offers to paste.
20. **Portals' first path segment.** Assumed: `/images`, `/scripts`, `/styles`, `/assets` are never a portal (now the same list in the
    bridge and in the panel). A customer portal whose suffix is one of those words would be read as a Workspace.

## G. Firefox and Edge (S17)

21. **Firefox.** `e2e/firefox/run.js` now opens one Workspace page (no g_form, shadow roots, a composer with a switch): the ticket from
    the address, the box found by its label, the switch read, a note typed in. Not covered there: the rich-text path of
    `execCommand('insertText')`, the Next Experience shell, a portal. Run L5 and L1 by hand in Firefox.
22. **Edge.** Still no automated run. Edge runs the Chrome build; run L1, L5, L13 by hand once in Edge on a Workspace.
