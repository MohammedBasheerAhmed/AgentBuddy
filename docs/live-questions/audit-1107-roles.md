# Roles and writes: what was assumed (audit of 2026-11-07, "write side and role gating", W-01 to W-20)

Area: what a person may do on the open form, and what Agent Buddy offers because of their roles. The code that was built keeps every
unknown as an unknown (see "How it behaves until you answer"), so none of this is a blocker. Run the lines in the console of an
already signed-in ServiceNow tab, as a fulfiller (not an admin) on a development site. A line that is marked WRITES sets a value in the
open form and nothing else; reload the page afterwards without saving.

Where the rules are: the bridge is `src/page/bridge.js` (`rolesFromUser`, `editabilityOf`, `heldAfter`); the profiles are
`src/profiles/profiles.js` (`ROLE_RULES`, `withProfiles`); the one visibility function is `src/features/visibility.js`. Tests:
`tests/roles-*.test.js`, `tests/writes-*.test.js`.

## How it behaves until you answer

- Roles: the bridge reads `g_user.roles`, else `g_user.getRoles()`, else asks a FIXED list of role names with `hasRoleExactly`. When
  none of them exists the answer is "not known" (null), never "no roles". Not known means: the panel works as IT, as it always did, and
  nothing is hidden because of it.
- A form whose list of editable fields is empty or missing is "cannot tell". Insert is tried and the value is READ BACK; a field that does
  not hold the text is reported as locked ("This field is locked on this form."), and Undo reads back the same way. No write is ever
  made to find out whether a field can be written (build rule 1).
- A form is called closed only when its Active box says false and it has a State box.

## A. Roles (W-03, W-17, W-20)

1. **`g_user.roles` and `g_user.getRoles()` on each surface.** Assumed: at least one exists on a classic form; on a Workspace and on a
   portal page neither may.
   Check, on a classic form, in a Workspace record and on a portal page (top frame and the form's frame):
   `[typeof g_user, typeof g_user?.roles, Array.isArray(g_user?.roles), typeof g_user?.getRoles, typeof g_user?.hasRoleExactly]`
   then `g_user.getRoles ? g_user.getRoles() : g_user.roles`.
   If a surface answers nothing: the panel stays IT there (as before) and the kind rule still gives a catalog task its fulfilment tools.
   If `roles` is a comma string or an array of objects: `cleanRoleList` in `bridge.js` is the one place to change.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (the classic form and the classic home page's inner frame have g_user (roles, getRoles, hasRoleExactly); the Next Experience shell and Workspaces have none, and NOW.user has only userID and isImpersonating).

2. **`hasRoleExactly` is exact, `hasRole` is true for an admin.** Assumed (documented): `hasRole('x')` is true for an admin on every name.
   Check as an admin and as a fulfiller: `['itil','admin','made_up'].map(r => [r, g_user.hasRole(r), g_user.hasRoleExactly(r)])`.
   If `hasRoleExactly` also answers true for everything for an admin, the fixed-list way (the last of the three) must be dropped: delete
   `probeRoles` from `bridge.js`; the first two ways are not affected.

3. **Which role names real fulfillers hold.** Assumed (base-system names, `ROLE_RULES` in `profiles.js`): `itil` (IT), `sn_request_write`,
   `catalog_admin`, `catalog_manager`, `catalog_task_editor` (request fulfilment), `sn_customerservice_*` and `sn_csm_*` (customer
   service), `sn_hr_core.*` except `sn_hr_core.basic` (HR), `sn_customerservice_manager` and `sn_hr_core.manager` (team lead).
   Check: for one person of each kind, `g_user.getRoles ? g_user.getRoles() : g_user.roles`. Also: is `sn_hr_core.basic` (and anything
   else under `sn_hr_core.`) held by ordinary employees? Which role does a catalog fulfiller who is not in IT hold? Which role marks a team
   lead for IT (there is none in the rules today; the group manager read still adds `lead`)?
   If wrong: one line each in `ROLE_RULES`, and the same names in `ROLE_PROBE` in `bridge.js` (only these can be found without a list).

4. **Profiles stay a choice.** Not an assumption: the person's own choice, and the organisation's locked profiles, always win; roles only
   decide what is shown until the person chooses. Nothing to check; listed because the audit asked (W-20).

## B. Closed and locked forms (W-01, W-06, W-07)

5. **What `getEditableFields()` returns.** Assumed: it names the fields that can be typed into when it is trustworthy, and answers `[]`
   (or fails) where it is not. This is the open question `assist.md` 9 asked.
   Check on (a) an open incident, (b) a closed incident, (c) a resolved incident, (d) a form with a UI-policy read-only field, (e) a Next
   Experience form: `[g_form.getEditableFields().length, g_form.getEditableFields().includes('work_notes')]`.
   Changes: if (a) is `0`, the "cannot tell" path is the whole mechanism (nothing to change). If (b) is non-empty and still lists
   `work_notes`, a closed form is only caught by the read-back (below), also fine.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (a closed incident lists 10 editable fields, without state, short_description and close_notes; isReadOnly('short_description') is true).

6. **A locked field takes `setValue` and keeps its value (the read-back's premise).** Assumed: on a field that is read-only for the
   person, `g_form.setValue` does nothing visible and `g_form.getValue` still answers the old value. WRITES (development site only):
   on a closed incident, `g_form.setValue('work_notes', 'probe'); g_form.getValue('work_notes')`, then reload without saving.
   Also on an open incident with the field made read-only by a UI policy.
   If `getValue` answers `probe` on a locked field: the read-back cannot tell locked from open there, and the only guard left is the
   closed-ticket signal and the list; say so, and the panel's "Inserted" must then be read as "put in the box", which is what the
   panel's line already says ("Review it. Then press Save.").

7. **Active and State on a closed ticket.** Assumed: `g_form.hasField('active')`, `g_form.hasField('state')` and
   `g_form.getValue('active')` answers the string `'false'` on a closed incident, a closed catalog task and a closed case.
   Check: `[g_form.hasField('active'), g_form.hasField('state'), g_form.getValue('active')]` on each.
   If it answers a boolean or `0`: change `formIsClosed` in `bridge.js` (one line); until then the read-back covers it.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (in part: active is not a field of the incident form).

8. **A page without a form of its own (Workspace, portal).** Assumed (`assist.md` 10): a box that is not found is "cannot tell", and the
   line under the button says the page may not take the text and that it is copied instead. Check: open an answer card in a Workspace on a
   closed ticket; the line is there and Insert, when pressed, copies.

## C. Prepare to close (W-04, W-05)

9. **Is `close_code` / `close_notes` on the form when the section is hidden?** Assumed: `g_form.hasField('close_code')` is true even when the
   Resolution section is not shown (it is shown only when State is Resolved on the base form), so a value is filled into a box the agent
   cannot see. Check on an In Progress incident: `[g_form.hasField('close_code'), g_form.isVisible && g_form.isVisible('close_code')]`.
   What it changes: if `hasField` is false when hidden, the existing "not on this form" line already covers it. If true, a later round
   can read `isVisible` and `isMandatory` and say "hidden until the State is Resolved" before the click. Today the result carries one
   line, "Check the state and the other required fields, then save.", and claims only what the read-back proved.

10. **`g_form.isMandatory` and `g_form.isVisible` exist** (documented, but not on every release). Check: `[typeof g_form.isMandatory, typeof g_form.isVisible]`.
    Not used yet; answer for the round that adds the pre-click line.

11. **The State list a person is offered.** Assumed: the State choices of the form are the ones this person may move to. Check: the options of
    the State box on a New and an In Progress incident. Not used yet.

## D. The channel of a reply (W-02, W-13)

12. **The requester does not see comments on a catalog task.** Assumed (the repo's own claim, `src/insights/stages.js`): Additional comments
    on an `sc_task` are not shown to the requester; they read the requested item. Check: as a requester open the request in the portal
    after an agent put a comment on its catalog task; is it there? Also for `incident_task`, `sn_customerservice_task`, `sn_hr_core_task`.
    If they DO see it: move `catalog_task` (and the task tables that show it) from `NOTE_FIRST_KINDS` to `CUSTOMER_COMMENT_KINDS` in
    `src/features/packs/kinds.js`, and `NO_REQUESTER_KINDS` in `src/lib/fillable.js`.
    Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (not guaranteed: comments have no field rule on task, incident or sc_task, so whoever can read the task reads them (work_notes needs itil)).

13. **Saving a comment emails the caller.** Assumed: it depends on the ticket's contact type and the site's notifications, so the panel says
    "The customer may be emailed." (not "Saving sends the comment"). Check: save a comment on an incident opened by phone and on one
    opened by the portal; is a mail sent? If it is always sent, the older sentence can come back; if never, drop the clause.

## E. Not done, and why (so nobody expects it)

- W-09 (HR handler has no "Close well"), W-10 (change has three actions) and the Workspace composer switch (W-12, S14) belong to the next
  wave; W-11 has its line (`limitedKindNote`), shown where the Ticket screen is built.
- W-14 (Team per-person rows only for a manager), W-15 (an inactive assignment group wins the vote) and W-18 (profiles are stored once
  per browser) need changes in files this pass does not own; the exact changes are in the report.
- W-16 (what the AI is told the agent can do): not built; a fixed "the agent can: ..." part would need reads for every action and nothing
  suggests an action the agent cannot take yet.
- W-19 (hide "Open a new article form" without a knowledge role): not built. Who may create or publish an article is decided by the
  knowledge base's own rules, not by a role name, so a role-based hide would be a guess in a place where a guess hides a button that works.
