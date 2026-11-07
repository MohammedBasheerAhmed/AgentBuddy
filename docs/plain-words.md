# Plain words: how Agent Buddy talks to a person

From audit 8 (2026-11-07). Agents and fulfillers are not developers. `tests/words-banned.test.js` fails the build on the words in
the right-hand column. The Arabic follows `docs/i18n-arabic.md`; the English text is the key, so a changed text needs its Arabic.

| Say | Never show |
|---|---|
| ticket (incident, request, task, case only when the type matters) | record, "{table} records", table, column, sys_id, any table or field name |
| ServiceNow site | instance |
| signed out; sign in again; "as you" | session expired, log in, "with your own session" |
| you, your role | your user, access rule, ACL, permission |
| AI key | API key (outside Settings > AI) |
| AI service, AI address | provider, endpoint, base URL (outside Settings > AI) |
| daily AI limit | tokens, token cap (tokens only in Settings > AI > Usage and limits, where the number is typed) |
| ticket history, notes and comments | field history, journal |
| "could not be read", "is not available to you" | HTTP codes (400, 403, 404, 408, 500), Table API, query, filter (as a database word), JSON |
| your administrator: Agent Buddy settings, policy, the AI service, the browser blocking the site | IT team, admin, key names such as disabledFeatures |
| your ServiceNow admin: what ServiceNow hides from the person | ServiceNow administrator |

## Rules

1. Every error is one plain clause (what happened), then one next step: Try again, Sign in again, Open Settings, Ask your
   administrator. Name a cause only when the person can act on it.
2. Codes stay in the error object (`code`, `status`) for logic and the audit log, never in the sentence.
3. A sentence that blames ("Your user cannot read ...") becomes a fact plus an action ("You can't see X with your role. Ask your
   ServiceNow admin if you need it.").
4. Policy and installer sentences (disabledFeatures, orgFormats, tokenBudgetPerDay, CSP) are for administrators: diagnostics and
   `scripts/check-policy.js`. The agent sees one line and "Ask your administrator".
5. Name a type of ticket only where the sentence is about that type: "incident" on an incident, "ticket" everywhere else.
6. "Masked" stays with its gloss ("personal details are hidden"); new titles say "hidden".
7. Settings > AI is where an administrator types provider, endpoint, API key, API version, deployment and tokens. They are allowed
   in `src/options/provider/**`, the labels of `src/providers/config.js` and the address checks of `src/lib/aiUsage.js`; the test
   lists each exception with its reason (`tests/words-list.js`). `src/options/diagnostics.js` and `src/policy/enterprise.js` are
   English for IT and are never shown in the panel. Fixed AI prompts (`src/features`) stay English and are not covered.

## Arabic

One word each: site = موقع ServiceNow, AI service = خدمة الذكاء الاصطناعي, AI address = عنوان الذكاء الاصطناعي, administrator = مسؤول
النظام, ServiceNow admin = مسؤول ServiceNow. Never المثيل, النسخة or نقطة النهاية for "instance" or "endpoint".
