# Live questions: read safety (security records sensitive by default; what a refused or limited read says)

Round 4, Phase 0 (`docs/round4.md`, agent B). Built without a real instance. Check each one as a user with only fulfiller roles (itil,
or a security analyst role where the question says so). For each: what was assumed, how to check it, what to change if it is wrong.

## Security, vulnerability, GRC and audit tables

1. **The table families are named `sn_si_`, `sn_vul_`, `sn_grc_`, `sn_risk_`, `sn_compliance_` and `sn_audit_`.** They are on the
   built-in sensitive list (`BUILT_IN_SENSITIVE_PREFIXES`, `src/context/kinds.js`) next to `sn_hr_`. Assumed tables: Security Incident
   Response `sn_si_incident`, `sn_si_task`, `sn_si_request`; Vulnerability Response `sn_vul_vulnerable_item`, `sn_vul_vulnerability`,
   `sn_vul_entry`, `sn_vul_remediation_task`; GRC/IRM `sn_grc_issue`, `sn_grc_profile`, `sn_risk_risk`, `sn_compliance_control`,
   `sn_compliance_policy`; audit `sn_audit_engagement`, `sn_audit_task`.
   Check (no admin needed): open a record of each application you can reach and look at the address: the table is the part before
   `.do` on a classic form, or after `/record/` on a workspace (Security Incident Response Workspace, Vulnerability Response
   Workspace, IRM Workspace). Or type `sn_si_incident.list` in the filter navigator: a list that opens is a table that exists.
   Change if wrong: add the real prefix to `BUILT_IN_SENSITIVE_PREFIXES` (and to the test in `tests/reads-sensitive.test.js`); until
   then an organisation can add it through the policy key `sensitiveTablePrefixes`.

2. **Neighbouring families that may hold equally sensitive data are NOT on the list yet**, on purpose, until someone confirms them:
   Container Vulnerability Response (`sn_vulc_`, not covered by `sn_vul_`), Security Operations common data (`sn_sec_`), Threat
   Intelligence (`sn_ti_`), Privacy Management (`sn_privacy_`), Third-party Risk (`sn_tprm_` / `sn_vdr_`), Business Continuity
   (`sn_bcm_`). Check: as question 1, on an instance with those applications. Change if wrong: add the prefixes that hold names,
   findings or investigation notes to the built-in list; leave reference data (`sn_ti_` observables may be fine) to the policy.

3. **A security record opened through `task`** (`/task.do?sys_id=<a security incident>`) is resolved to its real class with one small
   read (`resolveRealClass`), so it is minimised too. A security analyst whose ACLs hide `task` rows gets "its real type could not be
   looked up", which is treated as sensitive as well. Check: open a security incident through `task.do` and look at the notes under
   the pack (the Ticket screen) or the preview: free text must be missing until the organisation allows sensitive content.

## What a refused or limited read says

4. **Which words a 403 carries.** `deniedReason` (`src/context/access.js`) reads ServiceNow's JSON error ("message - detail"):
   words that name an ACL or read permission ("ACL", "security constraints", "Insufficient rights to query records", "do not have
   permission to be read", "Not permitted to read") make it an access rule ("<thing>: not available to you with your role"); words
   that name an access policy, the REST API, web services, the role `snc_platform_rest_api_access`, or "User Not Authorized" without
   ACL words make it the organisation's restriction ("your organisation blocks this kind of read for your role. Ask your ServiceNow
   admin."); a 403 with neither is an access rule.
   Check (no admin needed): while signed in as the agent, open these addresses in a tab of the instance and read the JSON the browser
   shows: `/api/now/table/sys_audit?sysparm_limit=1` (often closed to non-admins by an ACL), `/api/now/table/sys_user_has_role?sysparm_limit=1`,
   and `/api/now/stats/incident?sysparm_count=true`. Note the status (the browser's developer tools, Network tab) and the exact
   `error.message` and `error.detail`. If the organisation uses REST API access policies (System Web Services > API Access Policies),
   ask the ServiceNow admin which message a blocked request gets.
   Change if wrong: adjust `ACL_WORDS` / `POLICY_WORDS` in `src/context/access.js` and the cases in `tests/reads-refusals.test.js`.
   The status (denied) and "no retry, no other endpoint" do not change either way; only the sentence does.

5. **A REST API access policy refuses with 403, not 401.** If such a policy answers 401 ("User Not Authenticated"), Agent Buddy reads it
   as a lost session and says "sign in again", which will not help. Check: as question 4, on an instance whose admin has set an access
   policy for the Table API. Change if wrong: tell the two 401s apart by their body in `isSessionExpired` (`src/content/tableApi.js`)
   and give the policy one the `policy` reason.

6. **ServiceNow's rate limits answer 429** (System Web Services > REST API Rate Limiting), and a node that is busy or in maintenance
   answers 503 (sometimes 502 or 504 from the load balancer). Both 429 and 503 are retried twice (at most 5 seconds each, `Retry-After`
   honoured) and then said: "ServiceNow is limiting requests. Try again in a minute." / "ServiceNow is busy or under maintenance. Try
   again in a few minutes." Check: only with an admin's help (a rate-limit rule for the agent's role with a tiny limit), then open a
   ticket with every Insights row open. Change if wrong: `refusalError` in `src/content/tableApi.js`.

7. **An SSO step, a maintenance page or a proxy page arrives as HTML with status 200** (or 5xx) where JSON was asked for. It is said as
   "ServiceNow answered with a page instead of data: sign in again, or the instance may be under maintenance.", and the kept session
   token is dropped (a new sign-in brings a new one). A page that looks like ServiceNow's own login (`login.do`, `user_password`, a
   login redirect, `X-Is-Logged-In: false`) is still "Your ServiceNow session has expired". Check: let the session time out with the
   panel open (or sign out in another tab), then press "Try again" on a card; with SSO, do the same after the identity provider's
   session ended. Change if wrong: add the identity provider's address or page marks to `LOGIN_URL` / `LOGIN_PAGE` in
   `src/content/tableApi.js`.

8. **A column the instance does not have answers 400 only on the Aggregate API** (a group-by or average on an unknown column); the
   Table API leaves unknown columns out of `sysparm_fields` and ignores them in `sysparm_query`. Such a 400 ("Invalid group by field",
   "Invalid field") is left out quietly, like a table that is not there. Check: `/api/now/stats/incident?sysparm_count=true&sysparm_group_by=u_nothing`
   in a tab of the instance, and read the error. Change if wrong: `isMissingColumn` in `src/context/access.js`.
