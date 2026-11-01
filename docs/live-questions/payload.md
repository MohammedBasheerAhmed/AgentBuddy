# Live questions: what is sent to the AI (request layout, email clean-up, size, HR rule)

Built without access to a real instance or a real local model server. For each: what was assumed, how to check it as a user with
only fulfiller roles, and what to change if it is wrong.

## Email text in notes and descriptions (`cleanEmailText`, src/context/journal.js)

1. **Comments that came in by email carry the whole reply.** Assumed: the instance's inbound email action ("Update Incident (BP)" and
   similar) adds the email body to `comments` as it came, with the quoted thread, signature and legal notice, and starts it with
   `reply from: <address>`. Some instances already cut the reply at a separator line (a "Reply above this line" marker in the
   outgoing notification, a script, or a newer inbound action).
   Check: reply by email to a notification of a test incident from Outlook and from a phone; open the incident's activity and copy a
   comment. If the instance already cuts the thread, nothing here is harmful: the clean-up then finds nothing to cut.
   Change: if the instance uses its own separator line, add it to the reply headers in `replyHeaderAt`.

2. **The reply headers and sign-offs of the mail programs people use.** Covered: Outlook desktop and web (`From/Sent/To/Subject`, bold
   labels, a line of underscores, `-----Original Message-----`), Gmail and Apple Mail (`On ... wrote:`), mobile apps ("Sent from my
   iPhone", "Get Outlook for Android"), in English, German, French, Spanish, Dutch, Italian, Portuguese and the Scandinavian languages.
   Not covered: other languages and programs (Lotus Notes, Japanese clients). Where nothing matches, nothing is cut.
   Check: open the preview of "Summarise" on a few real email-heavy tickets; the note `(earlier quoted email left out)` shows where a
   thread was cut. Compare with the note in ServiceNow.
   Change: add the header form to `WROTE`, `H_FROM` / `H_SENT` / `H_SUBJECT` or `MOBILE`, with a test in `tests/payload-email.test.js`.

3. **A customer's own words are never cut.** The rules only cut below a recognised reply header (when there is own text above it that
   does not say "see below"), a signature block of name/title/contact lines after a sign-off, and a long legal notice at the end.
   Check: if a preview ever shows a customer sentence missing, note the shape of the email and make the matching rule stricter.

## Size of a request (`src/lib/tokens.js`, `fitToModel` in src/lib/pipeline.js)

4. **A model on this computer has a context of 4,096 tokens** (Ollama's documented default `num_ctx`; assumed for LM Studio and other
   local servers too, which also load models with a small context unless someone changed it).
   Its OpenAI-compatible endpoint, which Agent Buddy uses, cannot ask for more, and a longer prompt is cut from the start. So requests
   to a local model are kept under about 3,000 tokens: the oldest notes go first and the request says so.
   Check: run "Summarise" on a long ticket with Ollama; the preview ends with "Older notes and comments were left out so that the
   request fits the AI model". An older Ollama (before 0.6) defaulted to 2,048 tokens: its answers then miss the task or the rules.
   Change: a Settings field "Context size of my model" saved per provider and passed as `config.contextTokens` by
   `resolveProviderConfig` (src/providers/config.js) lets a person whose server was set up for more use it.

5. **The context sizes of cloud models** are taken from the model name (Claude 200k, GPT-5 272k input, GPT-4o 128k, Gemini 1M, DeepSeek
   64k, Mistral Large 128k); an unknown name (an Azure deployment, a gateway alias) is taken as 32,000. A ticket never comes close to
   that, so the guess only matters for a small model behind a gateway.
   Change: add the name to `KNOWN_CONTEXT` in src/lib/tokens.js.

6. **The estimate (about 4 characters per token for English, more for other scripts, plus 20%)** is on the high side for the
   tokenizers of current models. Check: compare `prepared.size.tokens` with the `usage.input` the provider reports for the same request
   (the audit log has the reported number). If the estimate is lower than the reported number, raise `MARGIN`.

## HR records need Strict mode (`assertRunnable`, src/lib/pipeline.js)

7. **HR tables are recognised by their name** (`sn_hr_` and the policy's `sensitiveTablePrefixes`, `isSensitivePack`), whatever record
   kind they are mapped to; HR child tables such as `sn_hr_core_case_payroll` start with `sn_hr_` too. A scoped HR application with
   another prefix needs `sensitiveTablePrefixes` in the policy.
   Check: open an HR case of each HR service your organisation uses and look at the table name in the address bar.
