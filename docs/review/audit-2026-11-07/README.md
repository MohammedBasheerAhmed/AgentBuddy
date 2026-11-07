# The nine read-only audits of 2026-11-07

Raw reports of the audit described in `docs/review/audit-2026-11-07.md`, kept as the agents wrote them (each finding has an ID, the
scenario, file and line as they were at that time, what it should do, and whether the claim was VERIFIED by running the code or ASSUMED).
Line numbers have moved since: search by name. The helper scripts the agents mention (`matrix.mjs`, `cls.mjs`, `s9-urls.mjs`, ...) were
scratch files and are not kept; the numbers they printed are quoted in the reports.

| Report | Area |
|---|---|
| `audit-1-screens.md` | Raw table, column, state and kind names on the panel screens (28 findings) |
| `audit-2-nonrecord-pages.md` | What the panel does on a page that is not a ticket: the root cause of `ui_page` |
| `audit-3-read-access.md` | Reads: absences stated as facts, caches across users, hidden fields (22 findings) |
| `audit-4-write-and-roles.md` | Writes and role gating: what is offered versus what the user may do (20 findings) |
| `audit-5-platform.md` | What ServiceNow supports for a non-admin session: labels, roles, write-ability, article URLs |
| `audit-6-links.md` | Every address the panel builds; one rule set and eight owner decisions |
| `audit-7-kind-fit.md` | Does each record type get what its worker needs (F1 to F23) |
| `audit-8-jargon.md` | A sweep of every sentence the product says (41 rows) and a style guide |
| `audit-9-surfaces.md` | Feature parity across classic, Next Experience, Workspaces, portals (S1 to S23, 15 live checks) |
