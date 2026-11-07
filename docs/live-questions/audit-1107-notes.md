# Live questions: the notes and errors a person reads when something could not be read (audit of 2026-11-07)

Workstream "notes and errors" (audit 1: I1, I3, I4, I5, E1; audit 3: R-11, R-12; audit 8: J01 to J06, J14, J16). Built without a real
instance. Check each one as a user with only fulfiller roles (itil); the first two need an administrator to set something up once, on a
test instance, and a fulfiller to run one line in the browser console. For each: what was assumed, how to check it, what to change if
it is wrong. The engine's own sentences are fixed and name no table, so none of the questions below is about wording on the screen: they
are about what the instance answers, which decides which fixed sentence is chosen.

1. **A REST API access policy answers 401 "User Not Authenticated" to a person who is signed in, with `X-Is-Logged-In: true`.** The
   audit found one support article that shows 401 (not 403) for a table-scoped request blocked by a policy. A 401 used to be read as
   "you are signed out"; now it is a lost sign-in unless the answer says otherwise, and it says otherwise when the header
   `X-Is-Logged-In` is `true`, or when the body names a policy (`access policy`, `API access`, `snc_platform_rest_api_access`, `API
   level`). Then the person is told "Not available to you. Your organisation has restricted it. Ask your ServiceNow admin if you need
   it." instead of "Sign in again". Assumed: the instance sends `X-Is-Logged-In` on API answers, `false` on a lost session and `true`
   while the session lives. Not assumed: a 401 with no header and no policy words stays a lost sign-in (the safe reading).
   Check: ask an administrator to add a REST API access policy that blocks `GET /api/now/table/incident` for the fulfiller role (or use a
   developer instance). As the fulfiller, on any form, run in the console
   `const r = await fetch('/api/now/table/incident?sysparm_limit=1', { credentials: 'same-origin' }); [r.status, r.headers.get('x-is-logged-in'), await r.text()]`
   and write down the three values. Then sign out in another tab and run it again: the status should be 401 and the header `false`.
   Change if wrong: `POLICY_401` and `isPolicyRefusal` in `src/content/tableApi.js` (the words and the header test); if the header is
   missing on a policy answer and the body has no words, there is no way to tell a policy from a lost sign-in and the 401 stays "sign in".
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (in part: without the X-UserToken header a signed-in REST call answers 401 "User is not authenticated"; a REST API access policy was not tested).

2. **The Table API's blanket ACL answers 403 "User Not Authorized" with the detail "Failed API level ACL Validation".** When an
   administrator turns on the API-level ACL, every Table API user needs the role `snc_platform_rest_api_access`; a person without it
   gets a 403 for every table. The phrase contains "ACL", which used to make it "an access rule on this table" (one table, a plain
   line per card); it is now the organisation's restriction (`deniedReason` tests `API level` first): one line for all the cards, with
   the administrator as the next step. Check: on the same test instance, turn the API-level ACL on, remove the role from the fulfiller,
   run the console line above and write down `error.message` and `error.detail`. Change if wrong: `API_LEVEL_WORDS` in
   `src/context/access.js` (the words) and the cases in `tests/notes-engine.test.js`.
   Answered live 2026-11-07: see docs/live-checks-2026-11-07.md (in part: a table the role may not read answers 403 "User Not Authorized" with "User is unauthorized to access table: <table>", an ordinary ACL; the API-level wording was not seen).

3. **A 400 "Invalid table <name>" (and a 404) for a table the instance does not have is still recognised, now in `error.detail`.** The
   read layer's message is a fixed sentence ("This does not exist on this ServiceNow site."), so the words ServiceNow used are kept in
   `error.detail` and read from there (`isMissingTable`). This was already question 3 of `reads.md` for the wording; the new part is
   that nothing reads the message any more. Check: open a customer service case on an instance without that application, or run
   `fetch('/api/now/table/sn_not_a_table?sysparm_limit=1')` and note the status and text. Change if wrong: `isMissingTable` and
   `isMissingColumn` in `src/context/access.js` (the regular expressions), and `refusalError` in `src/content/tableApi.js`.

4. **A fixed note per reason is enough for the person: the table is never named.** The engine used to write "Your user cannot read
   sys_audit." and the panel patched the name; now the entry says only what happened (not available with your role, none visible at all,
   could not be read just now, does not exist on this site, blocked by the organisation) and the panel names the thing with the label
   of its source (`src/lib/tableLabels.js`, or the words of a source that is not a table). Check: as a fulfiller who cannot read
   `sys_audit` (most fulfillers), open an incident, open the Journey card and read the note; as a CSM agent without `itil`, open a case
   and read the notes under Related and Known errors. Change if wrong: a note that is not specific enough goes in `NOTE_TEXT` or in the
   reader's own `tm()` sentences (`src/context`, `src/content/ops`), with its Arabic in `src/i18n/ar/notes.js`.
