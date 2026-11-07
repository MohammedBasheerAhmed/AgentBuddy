# Live questions: the plain-words pass (audit 8, 2026-11-07)

What was assumed while the words of the panel were made plain (`docs/plain-words.md`), how to check it, and what to change if it is wrong.

1. **The reason in brackets after an AI service error.** `{who} refused this request (Forbidden). Check the AI key and the model in Settings, or ask your administrator.`
   The bracket is the AI company's own reason, cleaned (`safeReason` in `src/providers/http.js`). Assumed: it is short and in English, and a
   person can ignore it. Check: use a wrong key, a wrong model name and a wrong address against each service a customer uses (OpenAI,
   Azure OpenAI, a gateway) and read what appears. If a reason is long or full of codes, drop the bracket for that status (the `why` part of `statusError`).
2. **"ServiceNow site" for "instance".** Assumed: agents and administrators both read "site" as their ServiceNow address (the
   first-run checklist already said "your ServiceNow site"). Check: ask two agents what "Agent Buddy only runs on ServiceNow sites you turn on" means. If they say "website", use
   "your ServiceNow" in Settings > Basics and keep "site" in the first run.
3. **"Ask your administrator" for the browser blocking the site.** Assumed: the person who manages Agent Buddy at the company is also the one
   who can change the browser's site rules (the old text said "your IT team"). Check: on a managed browser, refuse the site prompt and ask who the agent
   would call. If it is the service desk, say "your service desk" in `REFUSED_TEXT` (`src/sidepanel/SetupView.jsx`) and the Settings line.
4. **The unit of the personal daily limit (J08).** The audit suggested a limit counted in AI requests. Kept: Settings > Usage and limits still takes a number of
   tokens (the unit the AI company bills), and only there is the word used; every sentence elsewhere says "your daily AI limit". Question for the owner: should the personal
   limit be in calls only (the organisation's `tokenBudgetPerDay` stays as it is)? If yes, remove the token box and `dailyTokens` from `UsageSection.jsx`.
5. **"Masked" (J28).** Not changed: about 25 texts say "masked", and Settings > Privacy explains it. Question for the owner: replace it with "personal details hidden" everywhere, or keep
   "masked" with the gloss on first use? A full replacement touches every AI button's tooltip, so it needs a look at 320 px.
6. **Settings > AI (J26).** The technical words stay there (provider, endpoint, API key, API version, deployment, tokens) because an administrator types them, and the test lists each as
   an exception. Not done: folding the address and version hints behind an "Advanced" line, because a fold is new UI. Question: is Settings > AI used by agents on their own,
   or only by an administrator? If agents use it, fold the address box for the services that do not need one.
7. **"Snippet file" (J36).** `Choose a snippet file saved by Agent Buddy (Save to a file).` Assumed: a person who exported snippets remembers it as a file. Check: export, then
   import a text file and read the error. The CSV buttons keep "CSV" (leads open them in Excel).
8. **Policy typos (J27).** `Your organisation's settings name a feature this version does not have ... Tell your administrator.` Assumed: the feature id is still useful in the
   sentence ({ids}) so the administrator can fix the spelling. Check with a managed policy that has a misspelt `disabledFeatures` id.
