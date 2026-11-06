# Live questions: Close well (round 4, docs/round4.md)

Nothing here has run against a real instance. The Close well row's two facts, "Prepare to close", the Insert of two fields and Undo
were built and tested against fakes (tests/close-*.test.js: a fake g_form, a fake Workspace and portal page, the panel with a fake
content script). Check each as an ordinary fulfiller (itil), without admin. Where something is wrong, the code fails soft: the panel
says to pick the code by hand, or that Undo could not put a box back, and Copy still works.

## The close code (a choice, filled by its stored value)

1. **Value or label.** The look-alikes' `close_code_value` is the column's raw value from the Table API (`src/context/similar.js`
   `toHit`, `raw()`), and the vote fills the choice with it (`g_form.setValue('close_code', value)`). Assumed: the raw value is what the
   form's choice list holds (base incidents: older releases use the label as the value, "Solved (Work Around)"; newer ones a short code).
   Check: on an incident form, pick a close code, then in the browser console of that tab type `g_form.getValue('close_code')` (allowed
   for any user: it only reads your own form) and compare with the look-alikes' code. If they differ, Insert answers "That choice is not
   in the list on this form." and the panel says to choose it by hand; fix `close_code_value` in `src/context/similar.js`.
2. **`g_form.getOption(field, value)`** is assumed to exist on classic forms (UI16 and the classic form inside Next Experience) and to
   return nothing for a value the list does not have. Where it is missing the bridge sets the value, reads it back, and puts the earlier
   value back when the form did not take it. Check both on your instance: a code from another instance's list must be refused.
3. **Which forms have `close_code`.** Assumed: the incident (only incidents get the code filled, `CODE_KINDS` in
   `src/sidepanel/ticket/assist/answers/prepareClose.js`). A customer service case and a problem keep theirs in `resolution_code`, which is
   not fillable: the panel says which code to pick. Check whether your requested items, catalog tasks or plain tasks have a close code
   on their form (some instances add one). If a case's `resolution_code` should be filled too, it must be added to `FILLABLE_FIELDS`
   (another field of the named exception: the user decides).
4. **Workspace choice components.** On a Workspace (Service Operations Workspace, CSM Workspace) the close code is a component of the
   page (`now-select` in shadow roots), not a box. Agent Buddy never tries it (`choice-by-hand`): only the notes go in, and the panel
   says "Choose the close code ... yourself." Check that this is what happens, and that nothing on the page is clicked or opened.
5. **Portals.** Fulfillers rarely resolve on a portal, and portal ticket pages do not show a close code. Assumed: same as a Workspace
   (never tried). Check on Service Portal / Employee Center that Insert fills only the notes box, or says it cannot find one.
6. **The current code.** "The ticket already has ..." compares the vote with what is picked on a classic form (the stored value) or
   the saved code (its display value). A translated instance shows labels in the reader's language; the look-alikes' labels come in the
   same language, so they should agree. Check on an instance in another language that a ticket that already has the suggested code
   says so quietly and offers no code to fill.

## Undo after every Insert

7. **What `g_form.getValue` returns.** Undo compares the field's value now with what the insert left there (`after`, read right after
   `setValue`) and refuses when they differ. Assumed: for journal boxes (comments, work notes) and the notes boxes `getValue` returns
   exactly what was set. Check on classic and Next Experience: Insert a reply, then Undo, without typing: the box must go back.
8. **The article body (HTML).** The rich-text editor may tidy the HTML some time after `setValue`; Undo then says the box "was changed
   after the insert" and leaves it. Check whether Undo works on a knowledge article form; if it never does, say so in the panel.
9. **Workspace boxes.** After Agent Buddy types into a Workspace text box, does the component keep the text as typed (Undo compares
   ignoring runs of spaces), and does the restored text stick when the agent then presses Save (the same input and change events as an
   insert)? Check with work notes and the Resolution notes box.
10. **When Undo stops being offered.** Undo is offered while the same record is open and its form stamp has not changed (a classic
   form reloads on Save; a Workspace counts presses of Save, Update, Resolve, Submit and Ctrl+S: `src/content/index.js`). A save made
   another way (a UI action with another label, a keyboard shortcut of the Workspace) is not noticed: Undo would then put the earlier
   text back on the form, unsaved. Check which save buttons your Workspace has.

## The Close well row

11. **"Looks like a repeat"** uses the caller's other tickets that the "Same caller" card reads (incidents, requested items, cases) and
   compares short descriptions by keywords (two shared, or one and the same category or CI). Check that a real repeat is found and a
   different issue of the same caller is not; Arabic short descriptions depend on `src/lib/similar.js` (docs/live-questions/i18n.md).
12. **"Not yet: the caller has not confirmed"** stands for the check "The customer has not replied to your last message". Check with
   fulfillers that the short wording reads right; the other short reasons are in `src/checks/resolutionCheck.js` (`SHORT`).
13. **The organisation's format.** An organisation that set a format for "Write resolution notes" (Settings > Formats, policy
   `orgFormats`) does not change "Prepare to close": its notes follow the action's own prompt. Decide whether it should follow that
   format too (it would need an entry in `src/formats/formats.js`).
