# Live questions: how a table is called in front of a person (audit of 2026-11-07, root cause 2)

Workstream "labels" (`src/lib/tableLabels.js`). Built without a real instance. Check each one as a user with only fulfiller roles. For
each: what was assumed, how to check it, what changes if it is wrong. Nothing here needs an administrator.

## The names of the tables

1. **The out-of-box table names behind the plain nouns are the ones the code assumes.** Not verified: `task_ci` (affected items),
   `sysapproval_group`, `sc_category`, `cmn_cost_center`, `core_company`, `chat_queue_entry`, `cmdb_ci_netgear`, `cmdb_ci_db_instance`,
   `cmdb_ci_vm_instance`, `service_offering`, `sn_hr_core_service`, `sn_hr_core_profile`, `sn_si_incident`, `sn_si_task`,
   `sn_vul_vulnerable_item`, `sn_vul_vulnerability`, `sn_vul_remediation_task`, `sn_risk_risk`, `sn_compliance_control`, `sn_grc_issue`.
   Check: type `<name>.list` in the filter navigator of the instance. A list that opens is a table that exists; the title of the list is
   what the instance calls it. Change if wrong: fix the name in `KNOWN` (`src/lib/tableLabels.js`); a table that is not named there is
   still called by its family or by its name made into words, so nothing breaks, it only reads less well.

2. **The family prefixes hold the kind of record the family word says** (`sn_hr_*` is HR, `sn_customerservice_*` and `csm_*` customer
   service, `sn_si_*` security, `sn_vul_*` vulnerabilities, `sn_grc_*`, `sn_risk_*`, `sn_compliance_*`, `sn_audit_*` risk and
   compliance, `kb_*` knowledge). A table of such a family that is not in the list is called "HR record", "security record",
   "vulnerability record", "risk and compliance record", "customer service record" or "knowledge record". Check: open a list of one
   table of each add-on you have and read its title. Change if wrong: reword the family in `FAMILIES`; an agent who reads "security
   record" for something that is not security shows the family is wrong.

3. **Every HR case table is an HR case, a task of the family is an HR task** (`sn_hr_core_case_payroll`, `sn_hr_le_case`,
   `sn_hr_er_case`; the same rule as `kindForTable`). Check: open an HR case of each area and read the address (`/record/<table>/...`
   in a workspace, `<table>.do` on a classic form). Change if wrong: the regular expression of the family in `FAMILIES`.

## What the instance calls a table

4. **The display value of `sys_class_name` is the instance's own label for the class, in the person's language** (`{ value:
   'u_facilities_request', display_value: 'Facilities Request' }`), and it is a singular noun. `tableLabel` takes it as
   `options.instanceLabel`, lowers its Title Case words and makes the plural itself by adding an English "s", "es" or "ies" (it does
   nothing to an Arabic label). Check, as the fulfiller, in the browser console on the instance:
   `fetch('/api/now/table/task?sysparm_limit=10&sysparm_fields=sys_class_name&sysparm_display_value=all',{headers:{Accept:'application/json','X-UserToken':window.g_ck}}).then(r=>r.json()).then(j=>console.log(j.result.map(r=>r.sys_class_name)))`
   (on a Workspace without `g_ck`, copy the token the way the panel does, or read the label in the address bar of a list). What the
   answer changes: if the labels are plural already ("Facilities Requests"), `tableLabel` leaves a label that ends in "s" alone, so the
   plural reads right and only the singular ("a new facilities requests form") is off; if the display value is empty, the name made
   into words is used. Who passes the label: today no screen does (the header read does not return `sys_class_name`); the call sites
   that have a class label (My work rows, the ticket header after one more column) should pass it. Audit 7, F10: only
   `sys_class_name`, no `sys_documentation` read.

5. **A custom class that extends `task` shows up in `sys_class_name` with its own label; a custom table that does not extend
   `task` has no label at all in any read the panel makes** (the name made into words is used, e.g. "visit log"). Check: open a list
   of a custom table and compare its title with the words the panel shows. Change if wrong: nothing to change in the code; the
   question is whether the words made from the names are good enough, or one more small read (the label of the table) is worth it.

## The wording

6. **"customer service case" is what a plural note says; "case" is what the Write line says.** The note "You cannot read customer
   service cases." is longer than the CSM agents' own word, which is "case", and is shorter than nothing for an agent who also works
   HR cases. Check: ask three customer service agents which they would rather read. Change: `KNOWN.sn_customerservice_case` to
   "case" / "cases" (the Write line already says "case").

7. **"history" for the audit table and "chats" for the interaction tables.** `sys_audit` is the field history of a ticket (the notes say
   "You cannot read history."); `interaction`, `live_group_profile` and `sys_cs_conversation` are all "chats", although an
   interaction can also be a phone call or an email. Check: open an interaction that is not a chat. Change: a noun such as
   "conversations" in `KNOWN` for `interaction`.

## The email form in the Next Experience (audit 9, S10)

8. **The Email action of a Next Experience incident opens the classic email form at an address that has the form inside it.** Assumed:
   `/now/nav/ui/classic/params/target/email_client.do%3Fsysparm_table%3Dincident%26sysparm_sys_id%3D<id>%26...` (the whole inner
   address encoded, once or twice, in the path). Check: on a Next Experience incident press the form's Email action and read the
   address bar; then, with the panel on the Write screen, insert a subject: it must land in the Subject box. Change if wrong: the
   shape in `wrappedAddress` (`src/lib/fillable.js`). If the Email action opens the form in a dialog without changing the address,
   Insert for the email form cannot be matched by the address at all and `no-such-field` ("That field is not on this form") stays
   the answer; the page bridge would have to say which form it sees.
