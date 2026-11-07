# Audit 5: Platform research (what ServiceNow lets a NON-ADMIN browser session learn, and what it costs)

Researcher: platform auditor. Date: 2026-11-07. Read-only: no instance was called, no file in D:\AgentBuddy was changed.
Method: ServiceNow product docs (servicenow.com/docs), ServiceNow Community threads, vendor integration guides, plus a read of
`src/content/tableApi.js`, `src/context/access.js`, `src/page/bridge.js`, `src/content/sessionToken.js`, `src/profiles/profiles.js`,
`src/content/ops/profiles.js`, `src/context/kinds.js`, `docs/security.md`, `docs/build-rules.md`, `docs/live-questions/reads.md`.

Confidence words used on every claim:
- VERIFIED BY DOC = stated on a ServiceNow documentation page I fetched (URL given).
- REPORTED BY COMMUNITY = ServiceNow Community thread, KB snippet, or a vendor/integrator guide. One source unless stated. Not authoritative.
- INFERRED = my reasoning from platform behaviour I know, or from the above; nothing I fetched says it. Treat as a hypothesis to check.
- UNVERIFIED = I found nothing either way.

Honest limits: the community pages are JavaScript-rendered, so several fetches returned only a summary by the fetch tool. I quote what came back
and say where it was thin. I found NO official ServiceNow page for `/api/now/ui/meta`, `/api/now/doc/table/schema`, or
`/api/now/ui/user/current_user`; they are undocumented, so they can change in any release. Nothing here was run against a real instance.
I could not establish release differences (Xanadu, Yokohama, Zurich) beyond the two noted: the query_range / query_match ACLs (Yokohama patch, May 2025)
and the `GlideUser (Next Experience)` page, which the docs label with the Australia release.

---------------------------------------------------------------------------------------------------------------------------------

## 0. The one-paragraph answer

- Table label: no single dependable non-admin source exists. The cheapest is free: read `sys_class_name` with `sysparm_display_value=all` on rows you already read (label in
  the user's language, no extra ACL). It does not exist on flat custom tables. For everything else, ask `sys_documentation` once (table-label rows: `element` empty), and fall back to a
  humanised name. `sys_db_object` is reported admin-only by default. `/api/now/doc/table/schema` is the best single-request candidate but undocumented.
- Field and choice labels: record values get their labels for free from `sysparm_display_value=all` (documented). Column labels and the full choice list need `g_form.getLabelOf` /
  `g_form.getChoice` (documented, page side, form open only) or `/api/now/ui/meta/{table}` (undocumented, ACL-aware) or `sys_documentation` / `sys_choice`.
- Roles: the page bridge is the only no-install, no-admin source: `g_user.hasRoleExactly('itil')` (documented) or `g_user.getRoles()` (documented for Next Experience).
  The REST route (`sys_user_has_role`) is reported admin-only. Treat the answer as a HINT that decides what is SHOWN; the server's answers to real reads stay the only truth.
- Write-ability: there is NO endpoint that reports it, and a PATCH "attempt" is both forbidden by build rule 1 and misleading (a denied field write commonly returns 200 and changes nothing).
  The form (`g_form.getEditableFields()`) is the only source; it mixes ACL with UI policy, so say "locked on this form", never "you have no permission".

---------------------------------------------------------------------------------------------------------------------------------

## 1. Table labels (display name and plural for any table, including custom ones)

### 1a. Candidates, in the order I would trust them for a plain itil / fulfiller

| # | Mechanism (exact) | Needs | Works for a plain fulfiller by default? | Language | Cost | Confidence |
|---|---|---|---|---|---|---|
| 1 | `GET /api/now/table/<table>?sysparm_fields=sys_class_name,...&sysparm_display_value=all` (also `GET /api/now/stats/<table>?sysparm_count=true&sysparm_group_by=sys_class_name&sysparm_display_value=all`). The `display_value` of `sys_class_name` is the class's table label ("Incident"); `value` is the table name. | Read access to the rows (already needed). No metadata ACL. | Yes whenever the row read works. LIMIT: `sys_class_name` exists only on tables that are part of a hierarchy (extendable or extended). A flat custom `u_my_table` has no such column, so this gives nothing there. | The user's session language (INFERRED; translated labels come from the same server-side lookup as the form header) | 0 extra requests (a column added to a read already made) | REPORTED BY COMMUNITY: a thread shows `sys_class_name` returning `display_value` = "IP Router" next to `value` = `cmdb_ci_ip_router` with `sysparm_display_value=all` (https://www.servicenow.com/community/developer-forum/how-to-get-the-ci-class-name-through-rest-api/m-p/1591338). Param semantics VERIFIED BY DOC (Table API, below). The "label for class" reading is INFERRED. |
| 2 | `GET /api/now/table/sys_documentation?sysparm_query=name=<t>^elementISEMPTY^language=<lang>&sysparm_fields=name,label,plural,language` (or `nameIN<t1>,<t2>,...` for all tables on screen in ONE request) | Read ACL on `sys_documentation` | UNVERIFIED. The table is "Field Label" / "Language File": holds the text of table names plus singular and plural labels of each field, one record per installed language; key columns Table, Element, Language (BCP 47), Label, Plural (VERIFIED BY DOC: https://www.servicenow.com/docs/r/zurich/platform-administration/table-administration-and-data-management/c_DataDictionaryTables.html and https://www.servicenow.com/docs/r/platform-administration/system-localization/r_TranslationTables.html; the Zurich page gives no ACL). An integrator guide says a role-less integration user needs an explicit read-ACL pair on it (CData: https://cdn.cdata.com/help/BNN/ado/pg_beforeyouconnect.htm, REPORTED BY VENDOR). A fulfiller may still read it (the form header needs the label), nothing I found says. | Rows per language; only languages that have been translated have a row; pick the user's language then `en` (INFERRED fallback). A Community article warns language-pack rows can sit in the Global scope rather than the app's scope (https://www.servicenow.com/community/now-platform-articles/i18n-translations-and-cross-scope-issue-on-sys-documentation/ta-p/2324565). | 1 request per screen (batch with `nameIN`), cacheable for the session | The row semantics are VERIFIED BY DOC; "table label = row whose `element` is empty" is INFERRED (I know it from the Language File list; no page I fetched states it). ACL for fulfillers UNVERIFIED. |
| 3 | `GET /api/now/doc/table/schema` (list: each entry has `label` and `value`, e.g. "Incident"/`incident`) | Unknown. Not in REST API Explorer docs. | UNVERIFIED for itil. One blog says it "honours security restrictions": a table the user cannot access is omitted. | Probably the user's language (INFERRED) | ONE request for all tables the user may open; cacheable for the session. The cheapest complete source if it works. | REPORTED BY COMMUNITY (single 2021 blog, undocumented, "may change between releases"): https://davidmac.pro/posts/2021-11-26-schema-meta-api/ (mirror: https://main--jovial-clarke-f2945e.netlify.app/posts/2021-11-26-schema-meta-api). I believe the Explorer also calls `/api/now/doc/table/schema/<table>` per table; I found no source, INFERRED. |
| 4 | `GET /api/now/table/sys_db_object?sysparm_query=name=<t>&sysparm_fields=name,label,super_class.name` | Read ACL on `sys_db_object` | REPORTED to be NO by default: "custom read ACL, admin-only by default" (Merge: https://help.merge.dev/articles/8660564895-setting-up-servicenow-scopes-and-roles-for-non-admin-users) and "required for all data", needing an ACL pair for a non-admin user (CData, link above). | One string, in the instance default language. Translations are not in this table (INFERRED: they live in `sys_documentation`). | 1 request | REPORTED BY VENDOR only. Expect 403 for itil. Do not make it the primary. |
| 5 | `GET /api/now/ui/meta/<table>` | Unknown | UNVERIFIED for itil. Blog: honours ACLs (fields the user cannot read, and inactive fields, are omitted). Returns `result.columns` keyed by field name. I found no statement that it returns the TABLE's label at top level. | Probably the user's language (INFERRED) | 1 request per table | REPORTED BY COMMUNITY (same blog). Treat its table label as UNVERIFIED; check whether `result.label` or similar exists (live check C5). |
| 6 | Page DOM: classic form header text (`.navbar-title`), `document.title`, Workspace tab title | Nothing | Only for the open page, fragile markup | The page's language | 0 | INFERRED. Not an API; the markup changes by release. Not recommended as a source. |
| 7 | Server side `GlideRecord.getPlural()`, `getClassDisplayValue()` | A Script Include / Scripted REST on the instance | Needs an install | | | Ruled out: customers will not install anything. (Methods listed in an unofficial copy of the GlideRecord reference; https://www.scribd.com/document/342000611/Glide-Reference; REPORTED.) |
| 8 | `g_form.getTableName()` | Open form | Gives the NAME, not the label. No client call returns the table label (VERIFIED BY DOC: https://www.servicenow.com/docs/r/zurich/api-reference/c_GlideFormAPI.html lists `getTableName()` and `getLabelOf(field)`, nothing for the table label). | | | VERIFIED BY DOC (absence) |

### 1b. What I recommend for table labels
1. Take the label from any row you already read: add `sys_class_name` to the read with `sysparm_display_value=all` (zero cost; covers `task` children, `cmdb_ci`, `sys_user`-less lists).
2. For the tables on screen with no label yet: ONE `sys_documentation` read (`nameIN...^elementISEMPTY^languageIN<user language>,en`). If it answers 403, remember the denial for the session, stop asking, and humanise.
3. Optional, after a live check: ONE `/api/now/doc/table/schema` read per session, kept in memory, if it works for a fulfiller (it would replace 2 completely).
4. Fallback that always works and costs nothing: humanise the name. Strip a custom prefix (`u_`, `x_<vendor>_<app>_`, `sn_<app>_`), turn `_` into a space, capitalise: `u_my_table` -> "My table"; `sc_req_item` -> "Requested item" (a small built-in map for the well-known base tables gives the exact words: incident, change_request, problem, sc_req_item, sc_task, sc_request, kb_knowledge, sn_hr_core_case, sn_customerservice_case, ...).
5. Cache in memory only (labels are not ticket content, but build rule 7 says in-memory caches are fine; storing them would need the owner's decision).

Failure modes: 403 (ACL or API-level), 200 with zero rows (ACL filtered or the language row is missing: ask again for `en`), a label that differs from the one on the form because of a translation in another scope, a table whose label was edited by the customer (the sys_documentation row wins, not a built-in map).

---------------------------------------------------------------------------------------------------------------------------------

## 2. Field labels and choice labels

### 2a. Table API `sysparm_display_value`
- Official: `true` returns display values for all fields, `false` (default) returns database values, `all` returns both. Display values "can hurt performance because they don't read directly from the database". `sysparm_exclude_reference_link=true` omits the Table API link on reference fields. `sysparm_fields`: invalid names ignored; takes precedence over `sysparm_view`. VERIFIED BY DOC: https://www.servicenow.com/docs/r/api-reference/rest-apis/c_TableAPI.html (and the Xanadu / Yokohama / Zurich copies, same text).
- Shape under `all`: each field is `{ "value": "<stored>", "display_value": "<shown>" }`; a reference field also carried a `link` (removed by `sysparm_exclude_reference_link=true`). REPORTED BY COMMUNITY, plus the project's own live-question notes (e.g. `docs/live-questions/insights.md` line 9, reports.md line 17).
- Choice field: `display_value` is the choice label, `value` the stored choice value (REPORTED BY COMMUNITY: https://www.servicenow.com/community/developer-forum/how-can-get-choice-s-label-in-json-rest/m-p/1654700 per the search summary; the page text itself was not retrievable).
- Missing key trap: under `all`, ServiceNow often leaves `display_value` out for an EMPTY non-reference string field (so `close_code` can come back with only `value:""`); a code must read `display_value ?? value` (REPORTED BY COMMUNITY: https://www.servicenow.com/community/developer-forum/quot-display-value-quot-missing-in-api-call/m-p/3393481).
- Date and time: `display_value` is shown in the user's time zone and the instance/user date format; `value` is stored UTC. The Table API page does not state the format; the project already depends on this (`docs/live-questions/mywork.md` 9, `reports.md` 3) and flags it. INFERRED/UNVERIFIED for the exact format string.
- Language: choice labels and other translated values follow the session user's language (INFERRED; I found no sentence saying so).
- One setting applies to the whole response: you cannot get raw dates and display choices in one call (REPORTED BY COMMUNITY: https://www.servicenow.com/community/developer-forum/how-to-get-some-fields-in-raw-value-and-other-in-display-value/m-p/1428173). `all` is the right choice for a panel.
- A dot-walked field (`caller_id.department.name`) under `all` returns a `{value, display_value}` pair as well (INFERRED).

### 2b. Where a COLUMN label comes from (the Table API never returns it)
| Mechanism | Needs | Fulfiller default | Language | Cost | Confidence |
|---|---|---|---|---|---|
| `g_form.getLabelOf(fieldName)` (plain-text label), `g_form.getChoice(field, value)` (returns an object with label, value, disabled, index), `g_form.getOptions(field)`, `g_form.getOption(field, value)` (returns the option element; does not work on read-only fields) | Open classic form | Yes | The form's (user's) language | 0 requests; only fields on the open form | VERIFIED BY DOC: https://www.servicenow.com/docs/r/zurich/api-reference/c_GlideFormAPI.html. On Workspace `g_form` is not a global (REPORTED BY COMMUNITY: https://www.servicenow.com/community/developer-articles/how-to-get-gform-instance-inside-agent-workspace-for-devtools/ta-p/2329963: reached only by walking the shadow DOM and a React internal `props.glideEnvironment._gForm`; fragile and undocumented). |
| `GET /api/now/ui/meta/<table>` -> `result.columns.<field>.label`, `type`, `internal_type`, `mandatory`, `read_only`, `choices[]` (`label`, `value`, `parameters`), `reference`, `reference_display_field` | Unknown | UNVERIFIED for itil; ACL-aware; the author says it was built for integration users without admin and a plugin once broke its ACLs | Probably user's language (INFERRED) | 1 request per table, cacheable | REPORTED BY COMMUNITY (single blog, undocumented). |
| `sys_documentation?sysparm_query=name=<t>^element=<f>` (field label) or `name=<t>^elementISNOTEMPTY` (all labels of the table in one read) | Read ACL | UNVERIFIED (see 1a #2) | Per-language rows | 1 request per table | See 1a #2. |
| `sys_dictionary` | `personalize_dictionary` role per Merge | NO by default | Dictionary label is in the default language only | | REPORTED BY VENDOR (Merge, link in 1a #4) |
| `/api/now/doc/table/schema/<table>` | Unknown | UNVERIFIED | | | INFERRED (no source). |

Recommended: use `g_form.getLabelOf` where the form is open (classic); otherwise one `sys_documentation` read per table with `ui/meta` as the second candidate after a live check; fall back to humanising the column name (the project's `labelFor` in `src/features/parts.js` already does that).

### 2c. Choice labels
- For a stored VALUE the panel is showing: read the record with `sysparm_display_value=all`. Free, in the user's language, honours the user's translation. This is the dependable route.
- For the LIST of options (a picker): `g_form.getOptions(field)` / `getChoice` on the open form (documented); `ui/meta` `choices[]` (undocumented); `sys_choice` (`name`, `element`, `value`, `label`, `language`, `inactive`, `sequence`, `dependent_value`).
- `sys_choice` access for a fulfiller is UNVERIFIED. Merge says non-admins need the `personalize_choices` role (REPORTED BY VENDOR; that is a role normally tied to personalising choices, so the claim may be about writes). The project already reads it (`src/content/ops/insights.js` line 102) and fails soft.
- Translation of choices is stored as one `sys_choice` row per language (INFERRED from the Language File documentation and platform habit; not verified here). The current code filters `language=en`, so an Arabic user always gets English words (a finding for the colleagues: see section 8).
- Dependent choices: `sys_choice.dependent_value` plus the dictionary `dependent` field; `ui/meta` `choices[].parameters` probably carries the dependency (INFERRED, UNVERIFIED). The form does the filtering for you: `g_form.getOptions(field)` returns only the available options (VERIFIED BY DOC for `getOptions`; "available" semantics INFERRED).
- Reference fields: the label is the display value of the target row (the target's "display" column, not translated unless the column is a translated field).

---------------------------------------------------------------------------------------------------------------------------------

## 3. The signed-in user: identity and roles

### 3a. From the page (no install, no admin, no request)
| Source | What it gives | Where it exists | Confidence |
|---|---|---|---|
| Classic `g_user` (client GlideUser) | Properties `userID` (sys_id), `userName` (login), `firstName`, `lastName`; methods `getFullName()`, `hasRole(role, includeDefaults)` (true if the user has the role OR is admin), `hasRoleExactly(role, includeDefaults)`, `hasRoleFromList("a,b")`, `hasRoles()`. `includeDefaults` adds snc_internal / snc_external style default roles; default false. | Classic forms and lists, UI scripts, the classic `gsft_main` iframe | VERIFIED BY DOC: https://www.servicenow.com/docs/r/zurich/api-reference/c_GlideUserAPI.html (same on Xanadu, Yokohama, "Australia/latest"). The docs list NO `roles` property or `getUserRoles()`. |
| `g_user.roles` (array or comma string) | The list of role names | Classic UI in practice | The bridge reads it (`rolesOf` in `src/page/bridge.js` handles array and string). NOT documented. REPORTED BY COMMUNITY for old UI scripts (`window.NOW.user.roles`, https://www.servicenow.com/community/developer-forum/getting-a-user-object-in-a-ui-script/m-p/1695845); another poster says `NOW.user.roles` does not work in Service Portal. UNVERIFIED which releases still expose it. |
| `g_user.getRoles()` | Array of ALL the user's roles: granted, inherited, and from group membership | The "GlideUser (Next Experience)" client API, "only available in client scripts" | VERIFIED BY DOC: https://www.servicenow.com/docs/r/api-reference/GlideUserAPINX.html. The page does not say whether the same global exists in the page's MAIN world on Workspace or Polaris as seen from an extension. UNVERIFIED there. |
| `window.NOW` (`user_id`, `user_name`, `user_display_name`, ...) | Identity only | Service Portal and some shells | REPORTED BY COMMUNITY (same thread). The project's bridge already reads it (`userFromObject`, rootLevel). |
| `g_ck` | The CSRF token (`X-UserToken`) | Classic top window, `window.NOW.g_ck`, portal `$http` defaults | The bridge handles all of these. Not identity. |

Pitfalls (all three matter for "evaluate access"):
1. `hasRole('x')` is TRUE for any admin for every `x` (VERIFIED BY DOC: "or the admin role"). Use `hasRoleExactly` for a "does this person work incidents" test; a role LIST (`getRoles()`) is the honest way to show roles.
2. `g_user` is evaluated at page load. Role changes, or an elevated `security_admin`, show after a reload.
3. Everything from the page world is untrusted data (build rule 10; `docs/security.md` limit 3: a page script can forge the bridge's answers). So roles may only change what is SHOWN (which is what `src/profiles/profiles.js` rule 2 already says), never what is allowed.
4. In a Workspace the shell is Next Experience: the form is a UI Builder component in shadow DOM; `g_form` is not a global (community) and I found no source that `g_user` is a global there either. Treat "roles unknown" as its own state, NEVER as "no roles".

### 3b. By REST (what a content script can do with the user's cookie)
| Request | Result for a plain fulfiller | Confidence |
|---|---|---|
| `GET /api/now/table/sys_user?sysparm_query=sys_idDYNAMIC90d1921e5f510100a9ad2572f2b477fe&sysparm_fields=sys_id,user_name,name` (dynamic "Me" filter, already used in `sessionToken.js` `lookUpMe`) | Works as the project assumes (their own live question `reports.md` 103 still lists it as unverified). Requires exactly one row back (the code does). | INFERRED / project assumption. A forum poster suggests `/api/now/table/sys_user/me`; one poster only; do not use. |
| `GET /api/now/ui/user/current_user` | Appears in a Community thread; no response shape or ACL stated; whether it carries roles is UNKNOWN | REPORTED BY COMMUNITY: https://www.servicenow.com/community/virtual-agent-forum/rest-api-to-get-the-logged-in-user-details/m-p/3134472 . UNVERIFIED. Live check C7. |
| `sys_user.roles` (the "Roles" column on the user record) as `sysparm_fields=roles` for MY OWN row | Possibly a comma list of role names; whether a fulfiller can read it, and whether it includes inherited roles, I do not know | INFERRED from my platform knowledge (a `user_roles` column on `sys_user`). No source. Live check C8. Worth trying: it is the same row the project reads already. |
| `GET /api/now/table/sys_user_has_role?sysparm_query=user=<me>&sysparm_fields=role.name,inherited,state` | Reported "security_admin or a custom read ACL"; so 403 for itil by default | REPORTED BY VENDOR (Merge, link in 1a #4; Glean: https://docs.glean.com/connectors/native/servicenow/servicenow-custom-role). A Community case shows that a non-admin with a read ACL on `sys_user_role` still did not see roles from some scopes (https://www.servicenow.com/community/sysadmin-forum/some-roles-are-missing-when-requesting-the-sys-user-role-table/m-p/2535154). The project already lists it as an unverified probe (`reads.md` 4). Do not make it a source: it is admin-only by default and build rule 9 says "never use admin-only endpoints". |
| `GET /api/now/stats/sys_user_has_role?...` | Same ACL as the table | INFERRED |
| `GET /api/now/table/sys_user_grmember?sysparm_query=user=<me>&sysparm_fields=group.name,group.manager,...` | Merge says `user_admin` or a custom ACL for `sys_user_group` and `sys_user_grmember`. The project (My work, Team, profileHints) depends on reading them. Conflict: UNVERIFIED which is right on a fulfiller | REPORTED BY VENDOR vs project assumption. Live check C9. |
| GlideAjax / `xmlhttp.do` to a client-callable Script Include that runs `gs.hasRole()` | Needs a Script Include on the instance | Ruled out (nothing is installed). Old community pattern, REPORTED. |

### 3c. What I recommend
Primary: the page bridge (`getSessionInfo`): ask a FIXED list of role names with `hasRoleExactly` if present, else `getRoles()`, else `roles`; remember which form worked. Identity fallback: the existing `lookUpMe` read. Roles missing -> state "unknown". Do not use `sys_user_has_role`. Verify `sys_user.roles` for self and `ui/user/current_user` by live check; if either returns names to a fulfiller, they are the REST fallback for Workspace.

---------------------------------------------------------------------------------------------------------------------------------

## 4. Can read / can write: what the platform reports and how denial looks

### 4a. No endpoint for per-field or per-record write-ability
- I found no documented REST call that reports "may this user write this field of this record". `ui/meta` `read_only` is the dictionary flag (INFERRED), not the ACL result. The UI forms ask the server to render the form and the server applies field write ACLs while doing it (INFERRED from how a read-only field shows on a form).
- Server-side `canRead()`, `canWrite()`, `canCreate()`, `canDelete()` exist (named in the security docs, https://www.servicenow.com/docs/r/zurich/platform-security/instance-security-hardening-settings/sc-enabling-ajaxgliderecord-acl-checking.html, VERIFIED BY DOC for existence) but are reachable only through a Script Include: not available to us.
- A dry run does not exist. A PATCH "attempt" is forbidden here by build rule 1 and by `instanceFetch` (only GET), and would change data. Not an option, now or later.

### 4b. What a denied write looks like (for context; the extension never writes)
- Table API PATCH of a field the user may not write: commonly **200 OK with the field unchanged** (REPORTED BY COMMUNITY: https://www.servicenow.com/community/developer-forum/acl-allow-to-write-for-some-specific-fields-still-return-status/m-p/2700846 as summarised by the search tool: "ACL logic is applied server side and the 200 reflects only that the request succeeded"). Same pattern when the record is assigned to someone else (Security Incident thread) and for state transitions. Another answer: a field read-only by ACL or dictionary cannot be updated by API, one read-only only by UI policy can (REPORTED). Result: a write-denied field is silent. So "denied vs empty" cannot be learned from a write.

### 4c. What the form can tell (the only legitimate source)
- `g_form.getEditableFields()` returns the names of fields that are not read-only. UNDOCUMENTED (it is not on the GlideForm page); REPORTED BY COMMUNITY (https://www.servicenow.com/community/developer-forum/geteditablefields/m-p/1928635 per the search summary) and one commenter says it does not work in Agent Workspace. The bridge already uses it and says `isReadOnly()` answers true for everything on current releases (consistent with `isReadOnly` NOT being in the GlideForm doc).
- `g_form.isMandatory(f)`, `g_form.isVisible(f)` are documented; `setReadOnly` is documented as a setter only.
- Read-only on the form comes from the dictionary, the field's write ACL, a UI policy, a client script, or the record state. They look the same. Honest wording for the panel: "This field is locked on this form" (not "you do not have permission").
- On Workspace and portal pages there is no `g_form`; the bridge's DOM fallback can only see whether a control is disabled. Say "cannot tell".

### 4d. What a denied READ looks like (Table API GET)
| Case | What comes back | Confidence |
|---|---|---|
| No read ACL on the table (or API-level ACL fails) | **HTTP 403**, JSON `{"error":{"message":...,"detail":...},"status":"failure"}`. Wordings seen: message `Insufficient rights to query records`, detail `Field(s) present in the query do not have permission to be read` (a sys_script case: https://www.servicenow.com/community/ask-the-experts-forum/unable-to-access-sys-script-table-via-api-using-custom-role-403/m-p/3429694, quoted text VERIFIED in that thread); message `User Not Authorized` with detail `Failed API level ACL Validation` (a different thread, for every user including admin; seen only through a search snippet of the same thread's page 2: https://www.servicenow.com/community/ask-the-experts-forum/unable-to-access-sys-script-table-via-api-using-custom-role-403/td-p/3429694/page/2 ). | REPORTED BY COMMUNITY. Exact wordings are not stable across releases. |
| ACL removes some ROWS | **HTTP 200 with fewer rows**; the rows are not counted anywhere: `X-Total-Count` does not reflect the hidden rows, and the UI notice "N rows removed by security constraints" is not in the JSON. A page can therefore be shorter than `sysparm_limit` while more data exists. | REPORTED BY COMMUNITY: https://www.servicenow.com/community/developer-forum/records-missing-from-table-api-results/m-p/1518533 |
| Field-level read ACL on a column that is only REQUESTED (in `sysparm_fields`) | The column is omitted from the row (REPORTED for the `ui/meta` API: "a field will not be included if the user doesn't have read access to that field"). For the Table API I have no source that says omitted vs empty string vs masked. UNVERIFIED. Live check C10. | |
| Denied column used in `sysparm_query` | 403 "Field(s) present in the query do not have permission to be read" (the sys_script case above). | REPORTED BY COMMUNITY |
| Encrypted field without the encryption context | Hidden | VERIFIED BY DOC (Table API page) |
| Single record by sys_id the user cannot read | 404 in the doc for "not found"; for ACL the behaviour is 403 or 404 depending on release (UNVERIFIED). The project's `fetchRecord` treats null as "does not exist or is not visible", which is the safe reading. | |

### 4e. Query-time ACLs and silently ignored conditions (important for "empty vs denied")
1. Part of an encoded query that is INVALID (a column that does not exist) is dropped and the rest applied: results can look like the whole table. The property `glide.invalid_query.returns_no_rows` changes it instance-wide, and the Zurich GlideRecord reference says even with the property on, an invalid WHERE term can still be ignored in API results. VERIFIED BY DOC: https://www.servicenow.com/docs/r/xanadu/api-reference/rest-apis/c_TableAPI.html and https://www.servicenow.com/docs/r/yokohama/api-reference/rest-apis/c_TableAPI.html and https://www.servicenow.com/docs/r//zurich/api-reference/server-api-reference/c_GlideRecordAPI.html (as summarised by the search tool; I did not read the exact paragraph).
2. New ACL types `query_range` and `query_match` (Yokohama patch upgrade, May 2025) stop users from inferring hidden data by filtering. A user who fails them gets, in the UI, "Part of the query on sys_user has been ignored because of insufficient access for 'query_range'" or "Query range for the fields does not match the criteria to access it" (REPORTED BY COMMUNITY: https://www.servicenow.com/community/developer-forum/query-range-amp-query-match-acl-s/m-p/3288540 and the Query ACLs blog https://www.servicenow.com/community/developer-blog/query-acls/bc-p/3305272). Whether the Table API drops the condition (broader result) or fails (403 / zero rows) is UNVERIFIED. Does the Table API honour them? Almost certainly (same GlideRecord engine, INFERRED), but the REST outcome is unknown.
   Consequence for the read layer: a filter on a person or a group (`assigned_to=<me>`, `caller_id=<x>`, `sys_idDYNAMIC...`) may be ignored and return a larger set. Guard each safety-relevant read with a sanity check (the project already does one for "Me": exactly one row). For counts: if a filtered count equals the unfiltered count where it should be smaller, say "could not be filtered", not the number.

So "denied vs empty" has four distinct shapes for the panel: 403 (denied), 200 with zero rows (empty OR hidden: the project's `confirmEmptyIsReallyEmpty` is the right design), 200 with fewer rows (partial; never provable), and a missing/blank column (hidden or empty).

---------------------------------------------------------------------------------------------------------------------------------

## 5. Table API restrictions beyond ACLs (what makes it refuse by role) and the words

| Layer | Effect | Words / status | Confidence |
|---|---|---|---|
| Table-level read ACL (and field-level `table.*`) | 403 | see 4d | REPORTED BY COMMUNITY/VENDOR |
| "Table API" blanket ACL (API-level ACL), DEACTIVATED by default; when an admin turns it on, every Table API user needs the role `snc_platform_rest_api_access` | 403 for ALL tables for a user without the role | "User Not Authorized" + "Failed API level ACL Validation" reported (see 4d) | REPORTED BY COMMUNITY: https://www.servicenow.com/community/developer-forum/rest-api-restrict-table-access/m-p/1615932 ; the KB behind it is KB0813159 (https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0813159, not fetched; summary came through a search snippet: "Table API ACL is deactivated by default... all Table API users need snc_platform_rest_api_access... breaks Walk-up Experience"). |
| Table "Allow access to this table via web services" (Application Access tab on `sys_db_object`; in Fluent `allowWebServiceAccess`, default false for new tables); "Can read" cross-scope setting; scope `accessibleFrom` and `callerAccess` | If web-service access is off the Table API refuses for EVERYONE, whatever the roles | Wording UNVERIFIED | Property names VERIFIED BY DOC (Fluent Table API: https://www.servicenow.com/docs/r/application-development/servicenow-sdk/table-api-now-ts.html); the "web services" box on the table is REPORTED by a vendor guide (Netskope: https://docs.netskope.com/en/configure-servicenow-for-the-next-generation-api-data-protection) and Databricks' connector checklist. That the Table API reads this flag is INFERRED from those. Custom `u_*` and scoped `x_*`, `sn_*` tables are the likely cases; restricting caller access (cross scope) governs scripts of other scopes, not a user's session. |
| REST API Access Policies (`sys_api_access_policy`, System Web Services) | Per API, version, method, resource; an authentication profile with IP / role / group conditions. By default ALLOW ALL; once a policy is linked only what it lists works. | A Support KB example of a blocked table-scoped request shows **401 "User Not Authenticated"**; the community post says only "Access Denied". No source gives a 403 for a policy | REPORTED BY COMMUNITY/KB: KB2628660 (https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB2628660), https://www.servicenow.com/community/platform-privacy-security-blog/demystifying-rest-api-access-policies-what-you-need-to-know-part/ba-p/3493461 . Whether policies apply to browser-session (cookie + X-UserToken) requests: the sources do not address it (UNVERIFIED; ask the admin). |
| Domain separation | `sysparm_query_no_domain` is for admins or the `query_no_domain_table_api` role only; other users see only their domains | | VERIFIED BY DOC (Table API) |
| Rate-limit rules | 429 (+ Retry-After) | | The project already handles it; REPORTED |
| IP access control, instance firewall | 403 for the client IP | | REPORTED (community) |
| Encrypted fields | Hidden | | VERIFIED BY DOC |

Compare with `src/context/access.js`:
- `ACL_WORDS = /\bacls?\b|security constraint|insufficient rights|permission to be read|not permitted to read|no read access/i` and `POLICY_WORDS = /access polic|api access|rest api|rest_api|web service|snc_platform_rest_api_access|\buser not authori[sz]ed\b/i`, with ACL tested first.
- **Mismatch 1:** `Failed API level ACL Validation` contains "ACL", so it is classified as an access rule on the data ("not available to you with your role"). It is really the API-level restriction that closes ALL reads (the user lacks `snc_platform_rest_api_access`). The words "API level" (or "API-level") should win and be classed as policy. Confidence in the wording: REPORTED BY COMMUNITY (one thread, seen via a snippet). The DISTINCTION matters for the panel: a policy/API-level denial means every card will fail; an ACL denial is per table.
- **Mismatch 2:** a REST API access policy may answer **401** "User Not Authenticated" (KB example). `isSessionExpired` treats every 401 as an ended session and says "sign in again". INFERRED fix: a 401 whose response header `X-Is-Logged-In` is `true` (or absent while the page itself is still signed in) is not a lost session. The project's own `reads.md` question 5 already guesses this. I could not verify the header behaviour.
- "User Not Authorized" alone (no ACL words) goes to policy. Table-level read denials are reported with both "User Not Authorized" and "Insufficient rights to query records" in different threads; with "insufficient rights" present ACL_WORDS wins, so those are right.
- The 403 detail for a denied column in the query ("Field(s) present in the query do not have permission to be read") contains "permission to be read": ACL, correct.
- A table that does not exist answers 400 "Invalid table <name>" (project assumption, documented in `access.js`); that is community knowledge; a table with web services access off may use a different word. UNVERIFIED.

---------------------------------------------------------------------------------------------------------------------------------

## 6. Role sets: agent vs fulfiller vs HR vs lead

What I can say with sources: very little that is authoritative. I did not find an official table that maps product roles to personas, and role names change by release (the `sn_incident_read/write` and `sn_request_read/write` roles come from the scoped ITSM applications and are held by `itil` through role containment, INFERRED). Merge's guide ties `incident`, `problem`, `sc_task`, `sc_request` and `task` reads to `itil` (or `catalog_read` / `catalog_task` / `catalog_admin` for catalog tables), and CSM tables to `sn_customerservice_agent` (REPORTED BY VENDOR, link in 1a #4).

| Persona | Role signal (NOT sufficient alone) | Evidence signal readable by a fulfiller (preferred) | Notes |
|---|---|---|---|
| Works incidents (IT service desk) | `itil`, `sn_incident_write`, `itil_admin` (contains itil) | Open `incident` assigned to me: `/api/now/stats/incident?sysparm_count=true&sysparm_query=assigned_to=<me>^active=true`; member of groups whose tickets are incidents | `itil` is also what catalog task fulfillers usually hold, so `itil` does not separate IT from catalog. |
| Fulfils catalog tasks | `itil`, `catalog_task_editor`/`sn_request_write`, `catalog_admin` | Counts of `sc_task` / `sc_req_item` assigned to me (the project's `profileHints`) | Roles overlap with IT. Workload is the reliable test. |
| HR agent | `sn_hr_core.basic`, `.case_writer`, `.manager` (project prefix `sn_hr_core.`, `sn_hr_le.`, `sn_hr_sp.`) | Cases in `sn_hr_core_case` assigned to me (needs HR content allowed) | Prefix match is sound for the base HR roles; customers add their own. |
| CSM agent | `sn_customerservice_agent`, `sn_customerservice_manager`, `csm_ws_agent` | Cases in `sn_customerservice_case` assigned to me | The project's `sn_customerservice` / `sn_csm_` prefixes fit. |
| Team lead / manager | `itil_admin`, `*_manager`, `change_manager`, `problem_manager`, `major_incident_manager` | `sys_user_group.manager = me` and `active=true` (the project's `managesGroup`); assignment-group membership counts | A group `manager` field is the best single signal; it only needs `sys_user_group` read (ACL for fulfillers UNVERIFIED, see 3b). |
| Approver | `approver_user` | `sysapproval_approver` rows with approver = me | |
| Knowledge | `knowledge`, `knowledge_manager`, `knowledge_admin` | | |

Conclusion: roles are a weak hint, and the persona must come from the person's own workload and group management, which the project mostly already does. Never claim a person "has no access" from a missing role.

Compare `src/profiles/profiles.js`: role rules are exact names and prefixes, case-folded, base-system only; profiles are suggestions and the person can tick others (good). Missing: nothing prevents `hasRole` returning true for everything on an admin (only matters if a `hasRole` path were used; the code uses a role list).

---------------------------------------------------------------------------------------------------------------------------------

## 6b. Which URL shows a KNOWLEDGE ARTICLE for reading, and who sees what

Added at the coordinator's request. Source quality is the weakest of the whole file: I found NO official ServiceNow documentation page for the portal article URLs
or for `kb_view.do`; everything below is Community threads, one Community FAQ, and ServiceNow's own support site used as a living example. Nothing was run on an instance.

### 6b-a. The reader URLs and what each is
| URL form | What it opens | Who it suits | Version it shows | Confidence |
|---|---|---|---|---|
| `/kb_view.do?sysparm_article=KB0010035` | The platform ("native", classic) article viewer. This is also what the classic UI gives as the default "permalink". | Someone signed in to the platform UI | The LATEST version the user may read | REPORTED BY COMMUNITY: https://www.servicenow.com/community/knowledge-managers/question-about-method-for-opening-article-in-service-portal/m-p/3525959 and https://www.servicenow.com/community/servicenow-ai-platform-forum/using-permalinks-in-service-portal-for-knowledge-articles/m-p/1252455 (a ServiceNow employee calls it "the platform view, not Service Portal"; the original poster: "not an ideal user experience") |
| `/kb_view.do?sys_kb_id=<sys_id>` | The same viewer, pinned to one article version | Same | THAT version (the sys_id changes when a new version is published) | REPORTED BY COMMUNITY: https://www.servicenow.com/community/developer-forum/knowledge-article-portal-redirection/m-p/3204017 (the native widget link is `/kb_view.do?sys_kb_id=` + `article.sys_id`) |
| Service Portal: `/sp?id=kb_article_view&sysparm_article=KB0010035` | The portal's article page | Portal users (the Service Portal default suffix is `sp`) | Latest version the user may read | REPORTED BY COMMUNITY (ServiceNow employee in https://www.servicenow.com/community/servicenow-ai-platform-forum/using-permalinks-in-service-portal-for-knowledge-articles/m-p/1252455: "will show latest accessible article version to the user"). The same thread says out-of-the-box support for `sysparm_article` as the portal's DEFAULT link was missing; the out-of-box in-portal links use the sys_id form. |
| Service Portal: `/sp?id=kb_article_view&sys_kb_id=<sys_id>` | The same page for one version | Portal users | That version; an older version shows an "updated version is available" banner | REPORTED BY COMMUNITY (same thread; also https://www.servicenow.com/community/developer-forum/default-url-of-kb-article-to-permalink-url/m-p/3406148, where the out-of-the-box category tree builds `?id=kb_article_view&sys_kb_id=<sys_id>`) |
| Service Portal: `/sp?id=kb_article&sysparm_article=KB0021186` (and `id=kb_article&sys_id=<id>` in older portals) | The older article page id | Portal users | | REPORTED BY COMMUNITY: a reply in https://www.servicenow.com/community/knowledge-managers/question-about-method-for-opening-article-in-service-portal/m-p/3525959 calls it "a common solution". `kb_article` and `kb_article_view` both exist on many instances; the sources use `kb_article_view` more and ServiceNow's own support site uses `kb?id=kb_article_view&sysparm_article=KB...` (for example https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0794149, which proves the shape on a live KM portal). `sys_id` as the parameter of `kb_article` is INFERRED (I know it from older portals; no fetched source states it; the sources that name a sys_id parameter say `sys_kb_id`). |
| Knowledge portal: `/kb?id=kb_article_view&sysparm_article=KB...` | The Knowledge Management Service Portal ("KM portal") article view | Portal users | Latest accessible | Shape proven by ServiceNow's own support site (above). That the suffix is `/kb` on a customer instance is INFERRED. A Community FAQ says any portal built on the Service Portal framework (Service Portal, Customer Service, Consumer Service, HR Service Portal, Employee Center) can use the KM Service Portal article view page, and that after the New York release all knowledge articles in the Service Portal redirect to it by default: https://www.servicenow.com/community/knowledge-management-articles/knowledge-management-faq/ta-p/2321021 . It also says portals restrict articles by the knowledge bases tied to the portal record. |
| Employee Center: `/esc?id=kb_article_view&sysparm_article=KB0033675` or `/esc?id=kb_article&sysparm_article=KB00XXXXX` (also seen `esc?id=kb_article&table=kb_knowledge&sys_kb_id=<id>`) | Employee Center article page | Employee Center users | Latest (by number) | REPORTED BY COMMUNITY, UNRESOLVED: three threads give two page ids and nobody confirms which one is canonical (https://www.servicenow.com/community/hrsd-forum/knowledge-article-link-in-agent-assist-need-to-redirect-to/m-p/2720056 : the poster proposes both and a second user says it "Should be esc by default"; https://www.servicenow.com/community/knowledge-managers/generating-an-employee-center-kb-article-link-in-classic-itsm/m-p/3361803 : no format given). The advice that repeats: "follow the format of the URL that Copy Permalink gets you" in that portal. Must be settled on the instance. |
| Agent Workspace / Service Operations Workspace knowledge view | A workspace article view (opens inside the workspace) | Agents in a workspace | | The FAQ says searches in a workspace open the workspace view, searches in the portal the portal view, searches in the native UI the native view. A workspace article route is UNVERIFIED (the project routes `kb_knowledge` to the classic form on purpose). One thread reports a portal-relative link `?id=kb_article_view&sysparm_article=KB#######` does not work when clicked from a Workspace. |
| `/kb_knowledge.do?sys_id=<id>` (the project: `/nav_to.do?uri=kb_knowledge.do?sys_id=<id>`) | The article's AUTHORING FORM (record), not a reading page | Authors and knowledge managers; needs read access to the record | THAT version (a sys_id) | INFERRED (it is the table's form like any other; nothing I fetched describes it as a reader). |
| Partial link inside article bodies `?sysparm_article=KB...` | A relative link the platform resolves in whichever UI the article is shown | Links between articles, inside article HTML | | REPORTED BY COMMUNITY, one reply only: https://www.servicenow.com/community/knowledge-managers/generating-an-employee-center-kb-article-link-in-classic-itsm/m-p/3361803 ("auto resolves correctly whether clicked from classic or the portal interface"). Cannot be pasted into an email: it has no base. |

Two facts that decide everything else:
1. A NUMBER link (`sysparm_article`) follows the latest published version the user may read; a SYS_ID link (`sys_id` / `sys_kb_id`) is pinned to one version, and the sys_id changes each time the article is published again, so an old sys_id link goes stale ("outdated version" banner or an old text). REPORTED BY COMMUNITY (ServiceNow employee in 1252455, plus https://www.servicenow.com/community/developer-forum/knowledge-article-sys-id-is-getting-change-on-each-update/m-p/1457321 and the esc search result "kb article sys_id will change if it's published multiple times"). The project's own copy-link code already prefers the number (articleInfo.js comment): right.
2. The page the link names decides the experience; the tab the agent is in does not. A reader URL has to be built for the READER's UI.

### 6b-b. Does `kb_view.do` redirect to a portal? Does it respect "can read"?
- **I found no source that says `kb_view.do` redirects to a portal.** The property I found is `sn_km_portal.glide.knowman.serviceportal.enable_redirect`; when true it redirects the legacy Knowledge Management v2/v3 pages `kb_home`, `kb_find`, `kb_view_customer`, `kb_list`, `kb_tree`, `$knowledge` to the equivalent KM Service Portal pages. The list does NOT include `kb_view`. Source: Community FAQ, a Nov 2021 reply, https://www.servicenow.com/community/knowledge-management-articles/knowledge-management-faq/ta-p/2321021 . REPORTED BY COMMUNITY, one reply; I could not read an official properties page (the Knowledge properties reference, topic `r_KnowledgeProperties`, did not come up).
  So the comment in `src/insights/links.js` line 3 ("kb_view.do, which ServiceNow sends to the portal for people without the classic UI") and the one in `articleInfo.js` line 38 ("also shows the article to people who only use the portal") are **not supported by anything I could find**. They may be true on some instances (a no-role user might be handed on to `kb_view_customer`, which IS in the redirect list, when the property is on), but that chain is my speculation. Treat as UNVERIFIED.
- A site can add its own redirect: a Page Route Map on the portal that sends links containing `kb_view.do` to the portal article page, or editing the widget's link builder (https://www.servicenow.com/community/now-platform-forum/redirect-links-to-other-knowledge-articles-based-on-where-it-s/m-p/1143138 and the 3525959 thread, REPORTED BY COMMUNITY). So two instances can behave differently for the same `kb_view.do` link.
- Signed-out or restricted readers: `kb_view` is a platform page; a Community answer (2017) says you should not be able to view an article, even a public one, from the platform: the page must be a public page and many platform parts need a login; the suggested route is a public portal page (`/sp?id=kb_view2`-style) (https://www.servicenow.com/community/developer-forum/public-knowledge-article-redirecting-to-login-page/m-p/1489852, REPORTED BY COMMUNITY, 2017, old). Another thread: on the portal a restricted article shows "Article not found" (https://www.servicenow.com/community/developer-forum/how-to-redirect-unauthenticated-users-to-login-for-restricted/m-p/1931269).
- Can-read: article visibility is decided by the knowledge base and its Can Read / Cannot Read **user criteria** on the server for the viewer (`kb_view.do`, the portal pages and `sysparm_article` all show "the latest version the user has access to"); the property `glide.knowman.apply_article_read_criteria` makes the read criteria also bind knowledge contributors (REPORTED BY COMMUNITY, search summary). The portal also narrows by the knowledge bases attached to that portal (FAQ). Consequence: the SAME link can show the article to the agent and "not found" to the customer, in any of the URL forms. No URL form avoids that: the customer must be in the article's Can Read criteria.
- A customer without the classic UI: nothing I found says what they see on `kb_view.do`. If the instance blocks self-service users from platform UI pages, the link fails or lands on a login/blank page; a portal link does not have that problem. The portal-first choice is the safe one for customers (INFERRED).

### 6b-c. What I would use
1. **An AGENT who wants to read an article** (in the panel's "open this article"): the READING page, by number:
   - classic tab and workspace tab: `/kb_view.do?sysparm_article=<KBn>` (the platform viewer; for an agent the platform UI is available; shows the latest accessible version and does not drop them into an authoring form). Only if the article has no number fall back to `/kb_view.do?sys_kb_id=<id>`.
   - portal tab (the agent is in the portal the customer also uses): `<this portal>?id=kb_article_view&sysparm_article=<KBn>`; on Employee Center confirm the page id first (live check).
   - Keep `/kb_knowledge.do?sys_id=` ONLY for "edit this article / see criteria, versions, KB", clearly labelled; it is the authoring form. Today the code uses it for plain "open", which explains why agents see the form, and the portal URL (`id=kb_article&table=kb_knowledge&sys_id=`, a sys_id form with a `table` parameter that no source I found uses) on a portal tab. Mixed: classic on classic and workspace, portal on portal.
2. **A link pasted to a CUSTOMER**: build it for the CUSTOMER's front door, never from the agent's tab:
   - Number, never sys_id: `<customer portal suffix>?id=kb_article_view&sysparm_article=<KBn>`. `kb_article_view` is the page id with the most support (ServiceNow's employee, the live support site, the Employee Center suggestions, the FAQ). The Employee Center case is the open one.
   - The suffix is the problem: `/sp` (Service Portal, default), `/esc` (Employee Center), `/csm` and `/hrm` (customer service, HR), `/kb` (Knowledge portal), or a customer's own suffix. Instance with ONLY the classic UI and no portal: use `/kb_view.do?sysparm_article=<KBn>` (nothing else exists). Instance with Employee Center: `/esc?id=kb_article_view&sysparm_article=...` (page id to confirm). Instance with a custom portal: that portal's suffix (the same page id works on any portal built on the Service Portal framework, per the FAQ, if the article view page exists on it).
   - Source of the suffix, in order: (1) the portal the agent is on now (the code already reads `page.portal.base`); (2) a setting the owner/organisation chooses once ("Customer portal address", also a policy key) with a default taken from live check 6b-d; (3) only then `/kb_view.do`. Reading the portal list (`sp_portal`: `title`, `url_suffix`) is possible if a fulfiller can read it (UNVERIFIED), and it is the same GET read layer.
   - Never put the sys_id form in a customer link (stale version).
3. **Two copies of `articleShareUrl` exist and disagree** (this is the likely root of "sometimes portal, sometimes native"):
   | | `src/insights/links.js` (Ticket screen) | `src/sidepanel/knowledgeScreen/articleInfo.js` (Knowledge screen) |
   |---|---|---|
   | Portal tab, number | `...?id=kb_article_view&sysparm_article=` | `...?id=kb_article&sysparm_article=` |
   | Portal tab, no number | falls to `kb_view.do?sys_kb_id=` (platform) | `...?id=kb_article&sys_id=` |
   | Number accepted | `^KB\d{4,12}$` only | any 2 to 8 letters + 4 to 12 digits |
   | https only | no (http allowed) | yes |
   | Non-portal | `/kb_view.do?sysparm_article=` | same |
   A number with another prefix (the number prefix of `kb_knowledge` is configurable; one thread shows a `KI` number) is dropped by the Ticket screen and sent to a sys_id link. One builder should replace both. Same for the agent URL: `openRecord.js` `portalPageId` returns `kb_article` and the URL carries `table=kb_knowledge&sys_id=`.
4. The workspace routes: keep articles out of `/record/kb_knowledge/` (nothing says a workspace route for articles exists on every instance).

### 6b-d. One check that settles most of it (dev instance, already open signed-in tab)
Pick a real published article number (open any article, read its number). Then in the DevTools console:
```js
const n = 'KB0010001'; // use your real number
for (const u of [`/kb_view.do?sysparm_article=${n}`, `/sp?id=kb_article_view&sysparm_article=${n}`, `/sp?id=kb_article&sysparm_article=${n}`, `/esc?id=kb_article_view&sysparm_article=${n}`, `/esc?id=kb_article&sysparm_article=${n}`, `/kb?id=kb_article_view&sysparm_article=${n}`]) { const r = await fetch(u, { credentials: 'same-origin' }); console.log(u, r.status, r.redirected, r.url); }
```
It shows which suffixes and pages exist (a 404 or a redirect to the home page means the portal or page is not there) and whether `kb_view.do` is redirected by the server (`redirected: true` and a different `url`). Limits: a portal page is rendered by script, so status 200 does not prove the article shows; and it runs as the AGENT. Finish it by hand: in the portal your customers use, open the article and copy its "permalink/share" address (that settles `kb_article` vs `kb_article_view` and the parameter names for that portal), then paste `kb_view.do?sysparm_article=<n>` and the portal link into a private window while impersonating a plain employee with no roles (an admin can impersonate on the dev instance): note where each lands and whether the article text shows. A list of the portals and their suffixes: `await fetch('/api/now/table/sp_portal?sysparm_fields=title,url_suffix&sysparm_limit=20',{credentials:'same-origin'}).then(r=>r.text())` (403 means a fulfiller cannot read it).

---------------------------------------------------------------------------------------------------------------------------------

## 7. Pitfalls: Next Experience URLs and "is this a table form or a UI page?"

URL shapes (the project's `parseRelative` in `src/context/kinds.js` already handles the first three; none of this is documented by ServiceNow in a page I could fetch):
1. Classic form: `/incident.do?sys_id=...`, `/nav_to.do?uri=incident.do%3Fsys_id%3D...`.
2. Next Experience wrapper around a classic page: `/now/nav/ui/classic/params/target/<url-encoded classic path>`. Everything classic (forms, lists `*_list.do`, UI pages, `$pa_dashboard.do`) goes through it. The home is `/now/nav/ui/home`: no record.
3. Workspaces: `.../record/<table>/<sys_id>` under `/now/sow/`, `/now/workspace/`, `/now/cwf/agent/`, and scoped workspaces under `/x/<scope>/<name>/` (REPORTED BY COMMUNITY: https://www.servicenow.com/community/developer-forum/configure-workspace-url-in-next-experience/m-p/1621383 per the search summary). Workspace home and list pages carry no `/record/`.
4. Portals: `/sp?id=ticket&table=...&sys_id=...`, `/esc`, `/csm`, `/hrm`.

**The real pitfall:** a classic UI Page is served as `/<ui_page_name>.do`. The parser's rule `/\/([a-z][a-z0-9_]*)\.do$/` (kinds.js line 273) turns EVERY `.do` path that also carries a `sys_id` / `number` / query id into a record of table `<name>`. So `/hr_profile.do?sys_id=...`, `/my_page.do?sys_id=...`, `/ui_page_name.do?sys_id=...` become a "table" with that name. A UI page's name is a free word: it can be anything, so the panel shows "ui_page"-like raw names and reads a table that does not exist (a 400 "Invalid table" that the code hides as "missing"). I did not run it; this follows from the regex and from how UI pages are addressed (INFERRED, but strongly).

Reliable ways to tell a table form from a UI page (cheapest first):
1. The page itself: `g_form` exists and `g_form.getTableName()` returns the table name (VERIFIED BY DOC, GlideForm page). On a classic form this is definitive. A UI page without a form has no `g_form`.
2. One list from `/api/now/doc/table/schema` (if it works) answers "is `<name>` a table I can open?" for every URL without a probe; membership test; cached once.
3. A probe through the read layer: `GET /api/now/table/<name>?sysparm_limit=1&sysparm_fields=sys_id`. 400 with "Invalid table" means not a table; 403 means a table, denied; 200 a table. It reads rows of an unknown table, so run the blocked-table and sensitive-prefix guard first. Costs one request, cacheable per name per session. Wording of "Invalid table" is project-assumed (UNVERIFIED).
4. `sys_db_object` lookup: reported admin-only (1a #4): do not rely on it.
5. Structural hints on the address: `$pa_dashboard`, `sys_ui_page`, `/now/nav/ui/home`, `*_list.do`, no `sys_id`/`number` param -> not a record.
Note: `sys_ui_page` IS a real table (the UI Page record's own form), so its form and a UI page named `sys_ui_page` are not the same thing; the table form has `g_form`.

Other pitfalls:
- On Next Experience the classic form sits in an iframe inside shadow DOM; the bridge looks for `window.frames['gsft_main']`; I could not verify that this iframe is reachable from the top window on every Polaris release (project limit 4 says the same for Workspace).
- Workspaces: `g_form` is not global (community); `getEditableFields` reported not working there; `isSectionVisible` is documented not supported in Workspace (https://www.servicenow.com/docs/r/zurich/api-reference/c_GlideFormAPI.html).
- Choice label by a hard-coded `language=en` and a record opened in Arabic: see section 8.

---------------------------------------------------------------------------------------------------------------------------------

## 8. The project's read layer compared (and which answers fit the rules)

### What the read layer does today
- `src/content/tableApi.js`: GET only (`instanceFetch` refuses other methods). Only two API families are reachable: `/api/now/table/<t>` (`queryTable`, `fetchRecord`) and `/api/now/stats/<t>` (`countRecords`, `countByColumn`, `aggregate`). `queryTable` sets `sysparm_display_value` to `'all'` when the caller passes `displayValue: true`, otherwise `'false'`; it never uses `'true'`. `sysparm_exclude_reference_link=true` always. It returns the raw rows; each caller interprets `{value, display_value}`. There is no call to `ui/meta`, `doc/table/schema`, `ui/user`, `sys_documentation` or `sys_db_object`.
- `ops/insights.js` line 102 reads `sys_choice` for state and priority with `language=en^inactive=false` (labels always in English; a failure is soft).
- `src/context/access.js` words: see section 5.
- Role identity: page bridge (`getSessionInfo` -> `rolesOf`) then `lookUpMe` (dynamic "Me" filter, 3 columns, requires exactly one row). Roles feed only the first-run profile suggestion; `profileHints` adds `managesGroup` and `hasCatalogWork` from two counts.

### Which of my answers fit `docs/build-rules.md` and `docs/security.md`
| Mechanism | Fits? | Why |
|---|---|---|
| `sys_class_name` with `displayValue: true` on reads that already happen | FITS | Same endpoint, same read layer, one more column on an existing allowlist (rule 8: add with a reason). Needs `sys_class_name` on the spec for tables where it is absent (it is on `task`-family specs already, see `docs/security.md` 5A). |
| `sys_documentation` (table label, field labels) | FITS with approval | Goes through `queryTable` (GET, session, ACL applies). New auxiliary table: must be added to `docs/security.md` section 5A (that section currently says "no other table is read to resolve names"), a spec with a field allowlist (`name, element, label, plural, language`), and a live-question entry. A 403 must stay a final answer for the session (rule 9: no retry, no other route). |
| `sys_db_object` | DOES NOT FIT as a primary | Reported admin-only by default; rule 9 says never use admin-only endpoints. If tried as one candidate, a 403 is final. |
| `/api/now/doc/table/schema`, `/api/now/ui/meta/<t>`, `/api/now/ui/user/current_user` | NEEDS A DECISION | These are new request paths on the instance itself (rule 6 allows requests to the instance only through the existing read layer). They would be new functions in `tableApi.js`, a shared file: describe the change to the lead, extend the tests (`tests/readonly.test.js` scans for write verbs and `checkTable`-style guards), update `docs/security.md` 5A. They are undocumented (can change per release), so each needs a soft-fail fallback and a live check first. The table-name guard must also apply to `ui/meta/<t>`. |
| Page bridge `g_user.hasRoleExactly` / `getRoles()` / `g_form.getLabelOf` / `getChoice` / `getEditableFields` | FITS | Read-only, in the page's own world, already how the bridge works; answers are untrusted data (rule 10), shown but never used as authority. Add to the bridge's read-only surface and its tests. |
| `sys_user_has_role`, `sys_dictionary`, `sys_choice` as primary | DOES NOT FIT as primary | Admin-only by default (vendor reports); soft-fail only. |
| PATCH/POST "dry run" for write-ability | FORBIDDEN | Build rule 1, `instanceFetch`, `tests/readonly.test.js`. |
| Showing outcomes of real reads as access | FITS (best) | Rule 9 and `access.js`: ok / empty / empty-or-hidden / denied / blocked. This is the correct "evaluation of access". |
| The label ladder (sys_class_name, then sys_documentation, then schema list, then humanise) | NEEDS owner/security reading of rule 9 | Each source is the user's own session and ACL; a 403 on one is not a "denial of data" being circumvented, it is missing metadata for a display name. Safest design: a fixed ordered list, each source tried at most once per session per table set, a denial remembered, no retry, no impersonation. Say so in `docs/security.md`. |

### Findings for the colleagues (side effects of this research)
1. `insights.js` hard-codes `language=en` for choice labels: an Arabic user will get English "New/In Progress" words next to Arabic UI. Better: use `sysparm_display_value=all` labels on the rows themselves (they follow the session language), or ask `sys_choice` for the user's language then `en`.
2. kinds.js line 273: any `<name>.do` with an id is read as a table. UI Pages named after anything produce raw "table" names and failed reads (see section 7).
3. Do not treat "rows < limit" as "end of data": ACL filtering can shorten a page that still has later pages (REPORTED BY COMMUNITY). Check every pager and any "fewer than N means all".
4. A condition in `sysparm_query` can be ignored (invalid column, and possibly `query_range`/`query_match` ACLs on Yokohama and later). Counts like `assigned_to=<me>^active=true` can return a larger number than reality. A sanity check (compare with the unfiltered count, or read one row back and check the field) protects every claim that depends on the filter.
5. `access.js`: add "API level" to `POLICY_WORDS` and test for it before `ACL_WORDS`; and 401 handling for a policy (see section 5).
6. `bridge.js` `rolesOf` relies on an undocumented `g_user.roles`. Add `getRoles()` (documented for Next Experience) and `hasRoleExactly` (documented classic) in that order of preference; never `hasRole` (true for admins).
7. Roles absent must read "unknown", not "none" (Workspace has no known `g_user`).

---------------------------------------------------------------------------------------------------------------------------------

## 9. Live checks on the real dev instance (all GETs, read-only; the owner runs them in an already open signed-in ServiceNow tab)

Paste this once into the DevTools console of the ServiceNow tab (classic UI: pick the `gsft_main` frame in the console's context dropdown when the page is Next Experience wrapping classic; for Workspace use the top frame):
```js
const g = async (p) => { const r = await fetch(p, { credentials: 'same-origin', headers: { Accept: 'application/json', ...(window.g_ck ? { 'X-UserToken': window.g_ck } : {}) } }); const t = await r.text(); return { status: r.status, xTotal: r.headers.get('x-total-count'), body: t.slice(0, 1800) }; };
```

| # | Settles | One line |
|---|---|---|
| C1 | Table label from `sys_class_name` (1a #1) | `await g('/api/now/table/incident?sysparm_limit=1&sysparm_fields=sys_class_name,state,priority&sysparm_display_value=all&sysparm_exclude_reference_link=true')` : expect `sys_class_name: {value:"incident", display_value:"Incident"}` and `state` with `display_value`. Repeat on a custom table, `/api/now/table/u_<your_table>?sysparm_limit=1&sysparm_fields=sys_class_name`, to see whether the column is absent. |
| C2 | `sys_documentation` for a fulfiller (1a #2, 2b) | `await g('/api/now/table/sys_documentation?sysparm_query=nameINincident,sc_req_item^elementISEMPTY&sysparm_fields=name,element,language,label,plural&sysparm_limit=10')` (403 = not readable; rows with `element` empty = table labels; compare `language` values). Then `...&sysparm_query=name=incident^element=short_description^language=en&sysparm_fields=label`. |
| C3 | `sys_db_object` (1a #4) | `await g('/api/now/table/sys_db_object?sysparm_query=name=incident&sysparm_fields=name,label&sysparm_limit=1')` : expect 403 for a fulfiller. |
| C4 | Schema list (1a #3) | `const s = await g('/api/now/doc/table/schema'); s.status` ; then `JSON.parse((await fetch('/api/now/doc/table/schema',{credentials:'same-origin'}).then(r=>r.text()))).result.filter(x=>/^(incident|sc_req_item|u_)/.test(x.value)).slice(0,5)` : expect `{label,value}` entries. Also `await g('/api/now/doc/table/schema/incident')`. |
| C5 | `ui/meta` (1a #5, 2b, 2c) | `const m = JSON.parse((await fetch('/api/now/ui/meta/incident',{credentials:'same-origin'}).then(r=>r.text()))).result; [Object.keys(m), m.columns && m.columns.state && m.columns.state.label, m.columns && m.columns.state && m.columns.state.choices.slice(0,3)]` : look for a table-level `label` key and the choice list. |
| C6 | Language (1a, 2a, 2c) | Set the user's language to Arabic (user menu > Language, or Preferences) on the dev user, reload, repeat C1 and `await g('/api/now/table/sys_choice?sysparm_query=name=incident^element=state^language=ar&sysparm_fields=value,label,language&sysparm_limit=5')`. If `display_value` is Arabic, record values follow the session language; if `sys_choice` returns Arabic rows, choices are per-language rows. |
| C7 | Roles in the page (3a) | Console, in the form's frame: `[typeof g_user, g_user && g_user.hasRoleExactly && g_user.hasRoleExactly('itil'), g_user && g_user.getRoles && g_user.getRoles().slice(0,8), g_user && (Array.isArray(g_user.roles) ? 'array' : typeof g_user.roles)]`. Repeat on Next Experience home (top frame) and on a Workspace record: `[typeof g_user, typeof NOW, NOW && NOW.user && Object.keys(NOW.user)]`. |
| C8 | `current_user` and `sys_user.roles` (3b) | `await g('/api/now/ui/user/current_user')` ; `await g('/api/now/table/sys_user?sysparm_query=sys_idDYNAMIC90d1921e5f510100a9ad2572f2b477fe&sysparm_fields=sys_id,user_name,roles&sysparm_limit=2')` |
| C9 | Roles by REST and groups (3b) | `await g('/api/now/table/sys_user_has_role?sysparm_limit=1')` (expect 403) ; `await g('/api/now/table/sys_user_grmember?sysparm_query=userDYNAMIC90d1921e5f510100a9ad2572f2b477fe&sysparm_fields=group.name,group.manager&sysparm_limit=5')` ; `await g('/api/now/stats/sys_user_group?sysparm_count=true')`. |
| C10 | Denied vs empty column (4d) | Ask the admin for ONE field the dev fulfiller cannot read (Access Analyzer), then `await g('/api/now/table/<table>?sysparm_limit=1&sysparm_fields=sys_id,<hidden_field>,<visible_field>')`: is the key absent, an empty string, or a mask? Then `...&sysparm_query=<hidden_field>ISNOTEMPTY&sysparm_limit=1` to see the 403 or ignored-condition behaviour. |
| C11 | Ignored conditions (4e) | `[await g('/api/now/stats/incident?sysparm_count=true'), await g('/api/now/stats/incident?sysparm_count=true&sysparm_query=u_nope_xyz=1')]` : equal counts prove an unknown column is silently dropped. |
| C12 | Short pages (4d) | On a table with many rows the fulfiller can only partly see: `const a = await g('/api/now/table/<big_table>?sysparm_limit=100&sysparm_fields=sys_id'); const n = (JSON.parse(a.body.length<1800 ? a.body : '{"result":[]}')).result.length;` : easier: read `a.xTotal` and count rows in a full fetch; if rows < 100 while `x-total-count` > 100, the page was shortened by ACLs. |
| C13 | Write-ability on the form (4c) | On a record with a field you know is locked by ACL: `[g_form.getEditableFields().includes('<field>'), g_form.isMandatory('<field>')]` and compare with what the screen shows; do it on a Workspace record too (expect no `g_form` global). |
| C14 | Table vs UI page (7) | Open a UI page that takes `?sys_id=` and run `[typeof g_form, g_form && g_form.getTableName && g_form.getTableName()]` (expect `undefined`), then `await g('/api/now/table/<ui_page_name>?sysparm_limit=1&sysparm_fields=sys_id')` : expect 400 "Invalid table" on a real UI page name, 200/403 on a table. |
| C15 | Policy wording (5) | Cannot be run by a fulfiller. Ask the admin (or a dev instance with admin) to (a) turn on the "Table API" ACL and (b) add a table-scoped REST API access policy, then run `await g('/api/now/table/incident?sysparm_limit=1')` as the fulfiller and note status plus exact `error.message` and `error.detail` for each; also note the `X-Is-Logged-In` header value of a 401. Records the real words for `ACL_WORDS` / `POLICY_WORDS`. |

---------------------------------------------------------------------------------------------------------------------------------

## 10. Sources

Official (servicenow.com/docs), fetched:
- Table API reference (display_value, exclude_reference_link, fields, domain): https://www.servicenow.com/docs/r/api-reference/rest-apis/c_TableAPI.html
- GlideUser client API: https://www.servicenow.com/docs/r/zurich/api-reference/c_GlideUserAPI.html
- GlideUser (Next Experience) client API, `getRoles()`: https://www.servicenow.com/docs/r/api-reference/GlideUserAPINX.html
- GlideForm client API (`getLabelOf`, `getTableName`, `getChoice`, `getOptions`, `isMandatory`, `isVisible`; no `isReadOnly`, no `getEditableFields`): https://www.servicenow.com/docs/r/zurich/api-reference/c_GlideFormAPI.html
- Data dictionary tables (sys_documentation, sys_db_object, sys_dictionary; no ACL information): https://www.servicenow.com/docs/r/zurich/platform-administration/table-administration-and-data-management/c_DataDictionaryTables.html
- Translation tables (Field Label): https://www.servicenow.com/docs/r/platform-administration/system-localization/r_TranslationTables.html
- AJAXGlideRecord ACL checking (names canRead / canWrite): https://www.servicenow.com/docs/r/zurich/platform-security/instance-security-hardening-settings/sc-enabling-ajaxgliderecord-acl-checking.html
- Fluent Table API (`allowWebServiceAccess`, `accessibleFrom`, `callerAccess`): https://www.servicenow.com/docs/r/application-development/servicenow-sdk/table-api-now-ts.html
- Xanadu / Yokohama Table API (invalid query part dropped; `glide.invalid_query.returns_no_rows`): https://www.servicenow.com/docs/r/xanadu/api-reference/rest-apis/c_TableAPI.html , https://www.servicenow.com/docs/r/yokohama/api-reference/rest-apis/c_TableAPI.html (via search summaries)

Community / vendor (not authoritative):
- Schema and meta APIs blog: https://davidmac.pro/posts/2021-11-26-schema-meta-api/
- Non-admin integration tables and roles: https://help.merge.dev/articles/8660564895-setting-up-servicenow-scopes-and-roles-for-non-admin-users ; https://cdn.cdata.com/help/BNN/ado/pg_beforeyouconnect.htm ; https://docs.glean.com/connectors/native/servicenow/servicenow-custom-role
- 403 wordings: https://www.servicenow.com/community/ask-the-experts-forum/unable-to-access-sys-script-table-via-api-using-custom-role-403/m-p/3429694 ; https://www.servicenow.com/community/developer-forum/rest-api-restrict-table-access/m-p/1615932
- Rows silently removed: https://www.servicenow.com/community/developer-forum/records-missing-from-table-api-results/m-p/1518533
- PATCH returns 200 and nothing changes: https://www.servicenow.com/community/developer-forum/acl-allow-to-write-for-some-specific-fields-still-return-status/m-p/2700846 (page text not retrievable; relied on the search summary)
- Missing display_value under `all`: https://www.servicenow.com/community/developer-forum/quot-display-value-quot-missing-in-api-call/m-p/3393481
- `sys_class_name` display value: https://www.servicenow.com/community/developer-forum/how-to-get-the-ci-class-name-through-rest-api/m-p/1591338
- g_form in Workspace: https://www.servicenow.com/community/developer-articles/how-to-get-gform-instance-inside-agent-workspace-for-devtools/ta-p/2329963 ; https://www.servicenow.com/community/developer-forum/g-form-not-supported-in-workspace/m-p/2667131
- Query ACLs: https://www.servicenow.com/community/developer-forum/query-range-amp-query-match-acl-s/m-p/3288540 ; https://www.servicenow.com/community/developer-blog/query-acls/bc-p/3305272
- REST API access policies and the Table API ACL: https://www.servicenow.com/community/platform-privacy-security-blog/demystifying-rest-api-access-policies-what-you-need-to-know-part/ba-p/3493461 ; KB2628660, KB0813159, KB2297612 (support.servicenow.com, login-gated, seen through search snippets only)
- Current user endpoint: https://www.servicenow.com/community/virtual-agent-forum/rest-api-to-get-the-logged-in-user-details/m-p/3134472
- Missing roles for non-admin: https://www.servicenow.com/community/sysadmin-forum/some-roles-are-missing-when-requesting-the-sys-user-role-table/m-p/2535154
