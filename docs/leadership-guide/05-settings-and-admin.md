# Settings and admin

## The Settings page

Settings is the extension's options page, split into two pages (Basics and AI Assist), and every choice is saved at once.

The page is `options.html`; `options.html#ai` opens the AI Assist page directly, and the panel links to it where it says "Settings". How to reach it from the browser's own extension menu was not checked for this guide. The two pages are shown as tabs: **Basics** and **AI Assist**. A menu beside them lists the sections of the page on show ("Go to a section" on a narrow window). A section says "Saved." or "The browser did not save that change. Try again." when it fails.

If your organisation fixes a setting, it shows "Set by your organisation" (or a more specific line such as "Allowed by your organisation: gpt-5-mini") and cannot be changed. A banner at the top says "Some settings are managed by your organisation and cannot be changed." Where the organisation sets only a minimum (privacy mode, "Check what is sent"), you can still choose a stricter option, never a looser one.

### Basics

| Group | Setting | What it does | Default |
| --- | --- | --- | --- |
| Appearance | Colours | Light, Dark, or "Same as the computer". Applies to the panel, this page, the team page and the bar on the ServiceNow page. | Same as the computer |
| Language | Language of the panel and this page | "Same as the browser", English or Arabic (العربية). What is in a ticket is never translated. | Same as the browser |
| Language | Language of AI answers (shown only while AI is on) | "The language of the ticket" (a reply to an Arabic ticket is written in Arabic, to an English ticket in English) or "The language of the panel". | The language of the ticket |
| ServiceNow sites | Site address and "Turn on" | Agent Buddy only runs on sites you turn on. The browser asks you to confirm each one the first time (a build made for your organisation already has access to the approved sites and does not ask). "Turn off" removes one. Sites your organisation turns on itself are listed as "Turned on by your organisation". | No site |
| What you work on | Work profiles (tick boxes) | Decide which cards, actions and screens show first: "IT service desk and resolver", "Request fulfilment", "Customer service", "HR service delivery" (only where your organisation approved it), and the add-ons "Team lead" (the Team screen), "Knowledge manager" (duplicate articles, knowledge gaps, article reviews) and "Major incident, problem and change". At least one must stay ticked. A profile only decides what is shown first; a ticket outside your profiles still works. | None confirmed until you confirm the suggestion made from your roles |
| What you work on | Show everything | Shows every card and action, whatever you work on. | Off |
| What you work on | Skip AI for now | Use Agent Buddy without AI; everything under Insights still works. Hidden when your organisation switched AI off. | Off |
| My work | Follow-ups due after | How long a customer who has not had an update, or has not answered, counts as a follow-up due in My work: 2, 3, 5 or 7 days. | 3 days |
| Keyboard shortcuts | Open Agent Buddy; Summarise this ticket; Draft a reply | Lists the three shortcuts as the browser has them now. Summarise and Draft a reply open the panel and start on the open ticket; you still see what will be sent. "Change the shortcuts in the browser" opens the browser's own page (in Firefox: about:addons, Manage Extension Shortcuts). A shortcut with none set shows "Not set". | Suggested keys in the manifest: Alt+Shift+1, Alt+Shift+2, Alt+Shift+3 (Mac: Control+Shift+1, 2, 3) |
| Side rail | Show the side rail | A narrow rail on the right of the panel listing the five rows of each screen, then "All tools". | Off |
| Side rail | Show names | Names beside the rail's icons (only while the rail is shown). | Off |
| Side rail | Show the bar on ServiceNow pages | The small bar on the edge of ServiceNow pages. A click opens the side panel and starts the action there. Your organisation can switch it off for everyone (`disablePageBar`). | On |
| Side rail | The bar's actions for each kind of ticket | Per kind (Incident, Requested item, Catalog task, Change, Problem, Case, HR case): choose up to 4 AI actions the bar holds. Until you choose, the bar shows suggestions. | Suggestions for the kind |
| Privacy | Personal-data protection | "Standard", "Strict" or "Local model only" (see "What is masked and what you see before sending"). | Standard |
| Privacy | Check what is sent | "Show the exact outgoing text every time", "Show it the first time for each action", or "Do not show it". Changing it forgets which actions you already saw. | Show it the first time for each action |
| Your organisation's policy | (a note) | Appears only when the policy switches features off: "Switched off by your organisation: ...". Names in the list that match no feature are shown as a warning, because a misspelt id switches nothing off. | Not shown |
| Activity log | Export CSV, Clear log | The local log of what Agent Buddy did (see "Audit log"). | Empty |
| Stored data | Clear everything stored by Agent Buddy | Lists everything kept in this browser and removes it all after a confirmation ("Remove everything?"). The ServiceNow sites you turned on are turned off first. While your organisation sets a daily limit, the AI usage log stays. | Nothing to clear |
| Help from support | Copy diagnostics | Copies versions, your settings without any key, your organisation's policy in short and the last problems, as text. No ticket content, no key. | n/a |
| What leaves your computer | (a note) | "Only two things: reads from your own ServiceNow site, and the masked text sent to the AI address you chose. Agent Buddy has no server, no analytics and no tracking." | n/a |

"Stored data" lists these items: Settings; AI key (one per provider, the way you chose); Snippets; AI usage log (call counts and sizes, prices and limits you entered, never the text); Activity log (and its random salt); Checklist ticks (memory only, encrypted, gone when the browser closes); Saved dashboards; Tickets you opened (a scrambled code for the ticket, its kind and the time, for "since you last looked"; never the number, title or text; your organisation can turn it off with `rememberLastViewed`). It never keeps ticket text, names or the AI's answers.

### AI Assist

| Group | Setting | What it does | Default |
| --- | --- | --- | --- |
| AI provider | Provider | Which AI service. See "AI providers and keys" for the list. | Anthropic (Claude) |
| AI provider | Address (optional) or "Address (required)" | For the OpenAI-compatible providers, a company gateway or your own server (usually ending in /v1). Required for "Other (OpenAI-compatible server)". Providers with a fixed address show it under "Technical details: the address requests go to". | Empty (the provider's own API) |
| AI provider | Model | The model id; start typing to pick from the list, or type the exact name. "Load models from the server" asks the server for its list (OpenAI-style servers only). | The provider's default model |
| Key and connection | Where to keep the key | "This browser (simple)", "Memory only (forgotten on close)" or "Encrypted with a passphrase". | This browser (simple) |
| Key and connection | The key box, Save key, Show/Hide, Show saved key, Remove saved key | Enter the key and save it. The line under the box says what is saved (a short preview and its length) and where. | No key |
| Key and connection | Test connection | Asks the model for one word, applying the same organisation rules as a real run. | n/a |
| How AI answers are written | One editor per AI action | Sections, style, length and extra instructions (see "Answer formats"). Shown only when an action can be laid out. | The action's own format |
| Usage and limits | Your own daily token limit; Your own daily limit of AI calls | Nothing is sent once today's tokens (or calls) reach it. A whole number, or empty for none. The page shows today's and this month's calls and tokens and says which limit applies. | No limit |

When your organisation switched AI off, the AI Assist page shows only "AI is switched off": "Everything under Insights still works: facts, lists, checks and templates, read from ServiceNow as you. Nothing is sent anywhere."

## AI providers and keys

Agent Buddy talks to nine named AI providers plus any OpenAI-compatible server, and the key is kept in one of three storage modes you choose.

### The providers

| Provider (as shown) | Speaks | Address | Default model | Notes |
| --- | --- | --- | --- | --- |
| Anthropic (Claude) | Anthropic Messages API | api.anthropic.com (or an address you give) | `claude-sonnet-5-5` | Listed models: Claude Sonnet 5.5 (fast and capable), Claude Haiku 5.5 (cheapest), Claude Opus 5.5 (best quality). Key starts with `sk-ant-`. Models are listed by hand: no "Load models". |
| OpenAI / company gateway | OpenAI Chat Completions | api.openai.com, or a company gateway address | `gpt-5-mini` | Listed: GPT-5 mini, GPT-5; the model id is free text. Key starts with `sk-`. |
| Azure OpenAI | OpenAI form | Your resource, `https://<name>.openai.azure.com` | None: you type the deployment name | The model is the name of a deployment you created. Azure gives a key no list of deployments, so there is no "Load models"; "Other deployments to switch between" takes a comma-separated list for the model switch at the top of the panel. The key (KEY 1 or KEY 2) is sent only in the `api-key` header. "How to call it": the v1 API (recommended, `/openai/v1`) or the older deployment address with an API version (default 2024-10-21). You may paste a whole address ending in `?api-version=...`: it is split into the fields. |
| Google Gemini | OpenAI form | generativelanguage.googleapis.com | `gemini-2.5-flash` | Also listed: Gemini 2.5 Flash-Lite (cheapest), Gemini 2.5 Pro (best quality). Key starts with `AIza`. |
| Mistral | OpenAI form | api.mistral.ai | `mistral-large-latest` |  |
| Groq | OpenAI form | api.groq.com | `llama-3.3-70b-versatile` | Key starts with `gsk_`. |
| DeepSeek | OpenAI form | api.deepseek.com | `deepseek-chat` | Also `deepseek-reasoner`. Its hosted API is operated from China: check data-residency rules first (docs/deployment.md). |
| OpenRouter | OpenAI form | openrouter.ai | `anthropic/claude-sonnet-5.5` | Also `google/gemini-2.5-flash`. Key starts with `sk-or-`. |
| Ollama (on this computer, nothing leaves it) | OpenAI form | `http://localhost:11434/v1` | `llama3.1` | No key needed. |
| Other (OpenAI-compatible server) | OpenAI form | You must give the address, for example `http://localhost:1234/v1` | You type the model | Leave the key empty for a server on this computer that needs none. |

Every provider speaks one of two protocols; a provider's key is sent only to its own address, in that provider's header (`x-api-key`, `Authorization: Bearer`, or `api-key` for Azure). The address must be https (http only for `localhost` or `127.0.0.1`), with no user name or password. If you type a whole Azure address under "OpenAI / company gateway", Settings tells you to choose "Azure OpenAI" instead.

Your organisation can pin one provider (`aiProvider`), an address (`aiBaseUrl`), a list of vendors (`allowedProviders`) or models (`allowedModels`). Then the provider box is locked or shows only the allowed ones; a provider you chose earlier that is no longer allowed is said plainly ("Your organisation does not allow ..., which you chose before. Agent Buddy uses ... instead").

### Key storage modes

Where the key lives is the choice under "Key and connection" > "Where to keep the key". Changing it moves a key that is already saved.

| Mode | Where it is kept | After closing the browser | Good to know |
| --- | --- | --- | --- |
| This browser (simple), `local` | Agent Buddy's own database (an IndexedDB "vault") on the extension's origin. Not in `chrome.storage.local`. ServiceNow pages and Agent Buddy's content scripts cannot open it. | Still there | Anyone or any malware that can read your browser profile on disk can read it. Use a key with a spend limit. |
| Memory only (forgotten on close), `session` | `chrome.storage.session`, which Agent Buddy limits to its own pages. Nothing is written to disk. | Gone: you enter it again next time | The mode recommended for an approved rollout. |
| Encrypted with a passphrase, `encrypted` | The vault holds the key encrypted with your passphrase (PBKDF2-SHA256, 600,000 iterations, then AES-256-GCM). A new salt and IV for every encryption. | Locked until you unlock it once per browser session | Passphrase at least 8 characters. "There is no way to recover a forgotten passphrase: you would enter the key again." Move an existing key with "Encrypt the saved key". |

### Other facts about keys

- The key is read only by the extension's own pages (the side panel and Settings), never by content scripts or the ServiceNow page. Error messages never contain the key or the text that was sent.
- The line under the key box shows a short preview and the length. "Show saved key" shows the whole key and hides it again after 20 seconds (never offered for a key your organisation supplies, never in the side panel). A pasted key is cleaned (quotes, "Bearer ", spaces) before it is saved.
- "Remove saved key" removes it. An empty key box never removes a saved key by accident.
- Your organisation can force a mode (`keyStorage`; the stricter of two sources wins: `local`, then `encrypted`, then `session`) or supply the key itself (`providedApiKey`): then you never see or enter one ("The AI key is provided by your organisation. It is never shown here."). A supplied key is used only when the same policy also pins `aiProvider` or `aiBaseUrl`, so it can never be sent to a provider you pick.
- If your organisation requires an encrypted key and an older key was saved without one, it is not used until you choose a passphrase.

### A model on this computer (Ollama)

1. Install and start Ollama on your computer, then pull a model, for example `ollama pull llama3.1` (the key hint says: "Leave empty. Start Ollama first and pull a model, for example: ollama pull llama3.1.").
2. Settings > AI Assist > Provider: "Ollama (on this computer, nothing leaves it)". The address is fixed at `http://localhost:11434/v1`; the default model is `llama3.1`; type another model name if you pulled one.
3. Press "Test connection". The browser asks permission for `localhost`; Agent Buddy asks for one host at a time and never for every site.
4. Any other server on your computer that speaks the OpenAI format (for example LM Studio at `http://localhost:1234/v1`) works as "Other (OpenAI-compatible server)": give its address, leave the key empty.
5. For nothing at all to leave the computer, set "Personal-data protection" to "Local model only": then only a model on this computer is accepted ("Your privacy mode only allows an AI model running on this computer. Choose Ollama or another local server in Settings.").

A request to a model on this computer is given a longer time limit (5 minutes; 2 minutes for others). A local model reads a limited amount, so a very long ticket may be refused: "A model on this computer reads a limited amount. Choose an AI model that is not on this computer in Settings." Not verified here: whether Ollama needs a setting of its own to accept requests from a browser extension (nothing in the code or docs says).

## Answer formats

Settings > AI Assist > "How AI answers are written" lets you shape how an AI action writes its answer, and the choice is saved at once to your settings.

The same editor opens in the side panel under an action ("Change format"; "See format" when your organisation locked it).

### What you can change

- **Sections, style, length** (only the three actions that are laid out as sections): the ticket summary (`record-summary`), the hand-off brief (`handoff-brief`) and the discussion catch-up (`thread-summary`).
  - Sections: up to 10, in the order they are written, each with a heading (up to 60 characters) and an optional hint of what goes in it (up to 160). Use the arrow buttons to move, "x" to remove, "Add a section". Names must be unique.
  - Style: "A line or two of text" or "Short bullet points".
  - Length: "At most this many words", 30 to 500.
  - "Start from a layout": the standard layout or a preset (for the summary: "Issue, key actions, outcome" and "Situation, background, assessment, recommendation"; for the hand-off brief "Issue, key actions, open items, do first"; for the discussion catch-up "Decisions, open questions, next").
- **Extra instructions (optional)**: up to 600 characters about tone, length or wording, for example "Use plain words" or "Put the SLA date last". Every customisable action takes them. They are added after the action's own text and rules and say they never remove a rule.
- **Per action**: each action keeps its own format.

### Defaults

| Action | Style | Words | Sections |
| --- | --- | --- | --- |
| Ticket summary | A line or two | 120 | Issue, Impact, Done so far, Current state, Next step |
| Hand-off brief | Bullets | 180 | Summary, Symptoms and evidence, Steps tried (with results), Open questions, Do this first, Customer expectations (dates and SLA stated in the ticket) |
| Discussion catch-up | Bullets | 150 | Decisions, Open questions, Who owns what, Next |

### Actions that take extra instructions only

Their headings are read back by the panel, or the customer reads the text: `chat-summary`, `shift-handover`, `dashboard-insights`, `reply-draft`, `chat-reply`, `request-explain`, `missing-info`, `resolution-notes`, `resolution-improve`, `kb-article-draft`, `major-incident-comms`, `article-optimise`, `account-briefing`, `hr-case-brief`, `case-eng-escalation`, `problem-rca`, `change-cab-brief`. The email drafts, rewrite modes and Notes to ticket have no format.

### What cannot be changed

Nothing replaces a whole prompt. The rules about facts only, the customer-safe rules and the language rules stay in every request; the privacy filter adds its own rule that the ticket data can never give orders. The words you write hold no ticket data (they are typed, never read from a record), are cleaned (control and invisible characters removed) and are sent as written: so do not put ticket details in them.

### Buttons

"Save format"; "Use the standard format" (or "Use my organisation's format" where your organisation publishes one); "Show the instructions this sends" (the exact instruction text, so nobody has to guess); "Copy for your administrator" (puts the policy entry on the clipboard so the whole team can get it). States shown next to an action: "Set by your organisation" (locked, read-only), "Your organisation's format" (standard until you save your own), "Your format", "Your choice: the standard format".

### Organisation formats

An administrator can publish formats for everyone with the policy key `orgFormats` (at most 40 entries); see "For administrators: managed policy".

## What is masked and what you see before sending

Every AI request passes the privacy filter first, and you can read the exact outgoing text in a "Check before sending" sheet before it leaves.

### The rule

Every request to an AI goes through the privacy filter (the "PII firewall"). Nothing reaches the AI without passing it: the provider layer refuses a request the filter did not seal. If redaction fails, nothing is sent.

### What the filter does

1. Finds personal data and secrets in the text and replaces each with a placeholder such as `[PERSON_1]`, `[EMAIL_1]`, `[PHONE_1]`. The same value keeps the same placeholder in a request, so the AI can still tell who said what.
2. Wraps the ticket text as untrusted data; the AI is told it cannot be given orders by it and has no tools. Output is plain text: no markup, links or images are drawn.
3. Re-checks the finished text. If a high-confidence pattern is still in it, or a masked value is still written somewhere, the request is refused ("The final check still found unmasked data ..., so nothing was sent.").
4. Puts the real values back into the answer on your computer, so you read a natural draft. A password, key, card number, bank account number or ID number is never put back: its placeholder stays (for example `[CARD_1]`), and the safe-to-send check flags it if you try to insert it.

### What is detected

| Kind | Examples and notes |
| --- | --- |
| People on the ticket | The caller, opener, assignee, account, contact, approvers and note authors are known exactly and masked exactly. |
| Names written in the text | Found by the words around them: a salutation ("Hi Tom,"), a sign-off, Mr, Dr, Prof, "my manager is", "spoke with", "cc:", "per", "assigned to", "on behalf of", an @mention. Once found, a name is masked everywhere it is written afterwards in that session. A name with no cue ("Carol Diaz joined") can still pass in Standard mode. Strict and Local-only also mask capitalised full names with no cue. |
| Email addresses, phone numbers | By pattern. |
| Card numbers | With a checksum (Luhn). |
| Bank account numbers (IBAN) | With a checksum and the country's length. |
| National ID numbers | US, UK and India formats (regions on by default), Aadhaar with its checksum; Arabic-script labels and digits are folded, so a number written with Arabic-Indic digits is found too. |
| IP and MAC addresses | By pattern. |
| Dates of birth, postal addresses, employee ids | By label or format; can be missed when written in an unusual way. |
| Secrets | API keys, bearer tokens, a password after "password:", private-key blocks, and links with a user name and password. A password found once is hidden wherever it is repeated bare. |
| What you add yourself | In the "Check before sending" sheet you can hide any text; see below. |

Placeholder words you may see in the sheet as chips: Person, Email, Phone, Card, Bank account, ID, IP address, Device address, Birth date, Address, Secret, Hidden.

### Privacy modes

You choose the mode under Settings > Basics > Privacy > "Personal-data protection".

| Mode | What it does |
| --- | --- |
| Standard | "Masks detected personal data (names on the ticket, emails, phone and card numbers, IDs, secrets)." |
| Strict | "Also refuses sensitive fields and keeps HR descriptions and notes out entirely." It refuses a request that carries a field whose name looks sensitive (for example national id, date of birth, bank or tax details, salary, medical or health, passport, disciplinary, payroll) and, on HR and other sensitive tables, free text. It also masks capitalised full names with no cue. Some requests cannot be made in Strict ("Strict hides more, and some requests cannot be made in it."). HR tickets need Strict (or Local-only) for every AI function. |
| Local model only | "Only allows an AI model running on this computer. Nothing leaves it." Refuses any non-local endpoint ("Local-only mode: the AI endpoint is not on this computer, so nothing was sent."). |

Your organisation's `piiMode` is a floor: you can choose a stricter mode, never a looser one.

### The sheet you see before anything is sent

"Check before sending" shows:

- The action and where it goes, for example "Summarise this ticket - to DeepSeek (deepseek-chat)", or a company gateway or local server by its address.
- "Personal details are hidden before anything leaves:" with a chip for each kind hidden and how many (for example "12 names", "1 email address", "1 added by you"), or "No personal details were found to hide."
- "What goes in": tick boxes for the groups the request holds (Comments to the customer, Work notes (internal), The caller's other tickets, The account's other cases, Solved look-alike tickets, Knowledge articles, Incidents linked to this problem, Recent changes on the same item, Other changes overlapping the planned window). "The ticket's own details always go. Untick what this one does not need." Unticking only takes things out. "Use Strict privacy for this one" applies Strict to this request. "Remember this for ..." keeps your choice for that action.
- "What will be sent": the ticket read as a ticket (fields, notes and comments, the task), with every hidden value as a chip ("Person 1"). "The rules sent with it" opens the fixed rules; "Show the exact text" opens the whole request, character for character, as it leaves the browser.
- "Hide something else": select words in the preview or type them, and press "Hide". Every place they appear is hidden too, and the request is sealed again (it can only get stricter). The activity log counts these as numbers only.
- "Cancel" or "Send to AI". Escape cancels.

### When the sheet is shown

The setting "Check what is sent" decides: every time, the first time for each action, or never. The sheet is shown every time regardless ("This one includes other tickets, so you are always asked.") when the request carries text about other people's tickets or articles (look-alike tickets, linked incidents, an account's other cases, overlapping changes, article excerpts). In that case, if you checked the rest before, a short version says "Uses {others} from other tickets. You checked the rest of what this action sends before." with "Show what is sent".

### Honest limits

These come from docs/security.md, section 5.

- Names with no cue can be missed in Standard mode. On the project's own test set (165 names and 132 ticket-style traps, written together with the detector, so the numbers are optimistic) Standard had precision 1.00 and recall 0.98. This is why the sheet exists: read it and hide what you still see.
- The AI provider sees the masked text; its contract governs retention. A local model keeps everything on your computer.
- Prompt injection cannot be prevented, only made harder.

## Audit log

The activity log (Settings > Basics > "Activity log") is a local record of what Agent Buddy did, kept for accountability and security review without being a copy of the data.

### What an entry holds

Time; action (the feature id); kind of ticket (the table); a salted short hash of the record id (enough to see "the same record again", useless for finding it); provider, model and host; the privacy mode; whether the sheet was shown or skipped; how many items were masked, and how many of each kind (numbers only); input and output tokens; the outcome; the duration; and a short reason code when blocked (for example `BLOCKED_FIELD` or `NOT_LOCAL`).

### What it never holds

Ticket text, names, prompts, or the AI's answers.

### Outcomes

Sent, blocked, error, cancelled, inserted, copied. Every successful Insert and Copy is logged too (the result card, the Write screen, snippets, a carried draft), with the model that was really used.

### How to use it

1. Settings > Basics > Activity log. The table shows the newest 40 entries: Time, Action, Ticket type, Masked, Outcome (with the reason code in brackets).
2. "Export CSV" saves everything kept (file name `agent-buddy-audit-<date>.csv`). Columns: time, feature, table, record, provider, model, host, pii\_mode, preview, masked\_items, masked\_detail, input\_tokens, output\_tokens, outcome, reason, ms. Every cell is protected against being read as a spreadsheet formula.
3. "Clear log" empties it.

### Limits

The log keeps the newest 1,000 entries. It is on this computer only: another browser profile has its own. Your organisation can switch the export off (`auditExport`: "Export is switched off by your organisation."). "Clear everything stored by Agent Buddy" also clears it. The daily token budget is counted from a separate AI usage log (calls and tokens, never text), not from this one.

## For administrators: managed policy

An administrator can lock and tighten Agent Buddy through the browser's managed policy or a compiled-in enterprise build, and a person can never loosen what the policy sets.

Everything below is from docs/deployment.md, docs/security.md and `managed_schema.json`. "Not verified" marks what the documents themselves say was not tried on a managed device.

### How a policy works

- Agent Buddy reads the browser's managed policy (`chrome.storage.managed`, schema in `managed_schema.json`). A policy can tighten settings and lock them; a person can never loosen what a policy sets.
- Every key is optional. Names of tables, features and fields are not case-sensitive. A word that is not one of the allowed ones is ignored. Two cases block instead of being ignored (because ignoring them would loosen the policy): an `aiBaseUrl` that is not valid stops every AI call; an `allowedInstances` list with no usable entry allows no site.
- Chrome and Edge check each value against `managed_schema.json` first; a wrong value shows as an error on `chrome://policy` (or `edge://policy`) and has no effect. Check that page on one device before a rollout.
- Check a policy file before deploying: `node scripts/check-policy.js <file>` (a `.reg`, `.mobileconfig`, `.plist` or `.json`). It lists keys that would be ignored, read differently or that block AI calls, prints the policy as Agent Buddy reads it, and exits with 1 when something would not work as written.
- Two policies (a compiled-in one and the managed one) are combined setting by setting, keeping the stricter side.

### The keys

| Key | Type | When not set | What it does |
| --- | --- | --- | --- |
| `allowedInstances` | list | any instance the person turns on | Only these ServiceNow sites can be turned on: exact https addresses, or `*.corp.example.com` wildcards (at least two names after `*.`). An empty list allows no site. An exact address whose browser permission is already granted is turned on by itself. |
| `aiProvider` | text | person chooses | The only provider: `anthropic`, `openai`, `azure`, `gemini`, `mistral`, `groq`, `deepseek`, `openrouter`, `ollama` or `custom`. |
| `aiBaseUrl` | text | provider's own address | The only AI address. https only (http only for `localhost` or `127.0.0.1`), no user name, password, query or fragment. |
| `allowedProviders` | list | any | The providers people may choose from. When `aiProvider` is set it must be on the list. |
| `allowedModels` | list | any | The only model ids (Azure: deployment names), exact and case-sensitive; the first is the default. |
| `piiMode` | `standard`, `strict`, `local-only` | person chooses (standard) | The lowest privacy mode allowed (a floor). |
| `previewMode` | `always`, `first`, `never` | person chooses (first) | The least often the outgoing text is shown (a floor). |
| `keyStorage` | `local`, `session`, `encrypted` | person chooses (local) | Where the key is kept; forced exactly. |
| `providedApiKey` | text | each person enters a key | A key supplied by the organisation; used only together with a pinned `aiProvider` or `aiBaseUrl`. Anyone who can read the computer's policy store can read it: prefer a gateway that authenticates people another way. Not allowed in an enterprise build config. |
| `disabledFeatures` | list | all on | Feature ids to switch off (list below). |
| `blockedTables` | list | none | Tables never read or sent. |
| `blockedFields` | list | none | Columns never sent, also when a part of the request carries them. |
| `sensitiveTablePrefixes` | list | built-in families | More table prefixes treated like HR cases. Always included: `sn_hr_`, `sn_si_`, `sn_vul_`, `sn_grc_`, `sn_risk_`, `sn_compliance_`, `sn_audit_`. |
| `allowHrContent` | true/false | false | Allows HR case free text, but only with a pinned endpoint (see below). It opens all sensitive families, not only HR. |
| `tokenBudgetPerDay` | whole number | no budget | Daily token budget per person on that computer; the smaller of this and the person's own limit applies. |
| `auditExport` | true/false | true | Allows exporting the activity log as CSV. |
| `coachingEnabled` | true/false | false | Switches on the coaching snapshot (also needs Strict mode). |
| `disablePageBar` | true/false | false | Removes the bar of main actions from ServiceNow pages for everyone. |
| `aiEnabled` | true/false | true | `false` hides every AI Assist half and AI action; Insights stays. |
| `disabledSections` | list | all screens | Screens to hide: `mywork`, `team`, `write`, `knowledge`. The Ticket screen cannot be hidden. |
| `allowedProfiles` | list | all | Work profiles people may choose: `it`, `req`, `csm`, `hr`, `lead`, `km`, `mpc`. `hr` is offered only when named here or when `allowHrContent` is true. |
| `lockedProfiles` | list | people choose | Profiles set for everyone. |
| `orgSnippets` | list of objects | none | Canned replies for everyone, read-only: `{ "title", "body", "shortcut" }`, at most 200. |
| `orgFormats` | list of objects | each action's own format | How some AI actions write their answers, for everyone: `{ "feature", "sections", "style", "words", "extra", "locked" }`, at most 40. `locked: true` stops people changing that action. |
| `internalPhrases` | list | built-in list only | More words and phrases the safe-to-send check flags (team, system or project names). Added to the built-in list, never replace it. |
| `defaultDashboard` | object | ready-made dashboards | One Team-screen dashboard for everyone, in the file format "Save layout as a file" writes. Never locked. |
| `rememberLastViewed` | true/false | true | `false` keeps nothing for "Since you last looked". |
| `priorityAccounts` | list | none | Customer account names marked "Priority account" on cases (at most 500 names of up to 100 characters). |

An example `orgFormats` entry:

```json
{ "orgFormats": [
  { "feature": "record-summary",
    "sections": [ { "name": "Issue", "hint": "what the person reports" }, { "name": "Next step" } ],
    "style": "lines", "words": 100, "locked": false },
  { "feature": "reply-draft", "extra": "Sign off with: Kind regards, the Service Desk.", "locked": true }
] }
```

An action that takes extra instructions only (the reply draft and others) ignores `sections`, `style` and `words`; `node scripts/check-policy.js` lists every entry that would be ignored.

### Feature ids for `disabledFeatures`

| Where | Ids |
| --- | --- |
| Actions on a record | `record-summary`, `reply-draft`, `resolution-notes`, `prepare-close`, `handoff-brief`, `missing-info`, `sentiment-risk`, `next-best-action`, `thread-summary`, `routing-hint`, `kb-article-draft`, `major-incident-comms`, `hr-case-brief`, `account-briefing`, `caller-briefing`, `case-eng-escalation`, `problem-rca`, `change-cab-brief`, `article-optimise`, `chat-summary`, `chat-reply`, `translate-message` |
| Knowledge tools | `kb-merge-draft`, `kb-gap-outline` |
| Write: email drafts | `email-ask-info`, `email-status-update`, `email-resolution`, `email-approval-nudge`, `email-apology`, `email-closure` |
| Write: rewrite and notes | `rewrite-short`, `rewrite-friendly`, `rewrite-plain`, `rewrite-formal`, `rewrite-fix`, `rewrite-translate`, `rewrite-bilingual`, `notes-to-ticket` |
| Team (reports) | `reports` (the whole Team section), `shift-handover`, `dashboard-insights`, `weekly-summary`, `my-week-tip`, `coaching-snapshot` |
| Record tabs | `request-explain`, `resolution-improve`, `fulfilment-checklist` |
| AI Assist on the ticket | `ask-ticket`, `rewrite-own` |

The deterministic tabs (Request, Check, Article, Duplicates, Gaps, Snippets and the lists) have no feature id: `disabledFeatures` switches off their AI buttons only. Use `blockedTables` to stop what they read.

### HR content

HR text is sent to an AI only when all of these hold: the record is in an HR-family table (`sn_hr_*` or a prefix in `sensitiveTablePrefixes`, or a record opened as the base class `task` whose real class is one of those or could not be looked up); `allowHrContent` is `true`; and the policy pins the AI endpoint (`aiProvider` or `aiBaseUrl`) or the model runs on the person's computer. Pin both `aiProvider` and `aiBaseUrl` for HR: `aiProvider: openai` on its own still allows the public OpenAI address. HR tickets also need Strict (or Local-only) privacy mode for every AI function, and the HR case brief needs it too. Otherwise the run is refused and the person is told to ask their administrator.

### Blocked tables and fields

- `blockedTables` is enforced where data is read, not only when an AI run is prepared: the record, its related lists, the table a request-form answer points at, the journal of a record of that table, and tasks of that class. The panel says "Your organisation does not allow Agent Buddy to read X records". The content script re-reads the managed policy every 30 seconds, and the side panel sends its own copy with every read; the two are merged. Whether a content script can read `chrome.storage.managed` itself is **not verified** (docs/live-questions/policy.md): test it on one managed browser.
- `blockedFields` stops a request when a part of it is that field or carries it (a list of linked incidents carries `short_description` and `close_notes`).

### The recommended profile for a security-approved rollout

| Setting | Value | Why |
| --- | --- | --- |
| `allowedInstances` | your instances | People cannot turn it on for any other site. |
| `aiProvider` + `aiBaseUrl` | `openai` + your internal gateway, or `azure` + your Azure OpenAI resource | One approved AI endpoint. |
| `allowedProviders` | only if you do not pin one provider | Rules out every other vendor. |
| `allowedModels` | the approved models (Azure: deployment names) |  |
| `piiMode` | `strict` (or `local-only` with an internal model) | Raises the floor; people can only go stricter. |
| `previewMode` | `first` or `always` | People see exactly what leaves the browser. |
| `keyStorage` | `session` | The key is memory-only and cleared when the browser closes. Or supply the key through your gateway. |
| `allowHrContent` | `false` | HR free text is never sent. |
| `sensitiveTablePrefixes` | your own HR, legal or employee-relations table families | Treated like HR cases. |
| `disabledFeatures` | `["coaching-snapshot"]` until HR or works-council sign-off |  |
| `blockedTables` / `blockedFields` | tables or fields that must never be read or sent |  |
| `disablePageBar` | `true` if a bar drawn inside ServiceNow pages is not acceptable | The side panel is unaffected. |
| `tokenBudgetPerDay` | an agreed daily cap | Cost and abuse control; nothing is sent once it is reached. (The sample file uses 200000.) |

The same profile, ready to deploy, is in `docs/review-pack/policies/`. Replace `EXTENSION_ID` (shown at `chrome://extensions` or `edge://extensions`) and the example addresses, then run `node scripts/check-policy.js <file>`.

| File | Where it goes |
| --- | --- |
| `chrome-windows.reg`, `edge-windows.reg` | Windows registry (`HKLM\SOFTWARE\Policies\Google\Chrome\3rdparty\extensions\<EXTENSION_ID>\policy`, or the Edge equivalent). Group Policy Preferences, Intune or any registry tool. Also sets `ExtensionInstallForcelist`. |
| `chrome-macos.mobileconfig`, `edge-macos.mobileconfig` | macOS configuration profile for your MDM. Give the `PayloadUUID` values new UUIDs. |
| `chrome-linux.json`, `edge-linux.json` | `/etc/opt/chrome/policies/managed/agentbuddy.json` (Chromium: `/etc/chromium/policies/managed/`); Edge: `/etc/opt/edge/policies/managed/agentbuddy.json`. |
| `google-admin-console.json` | Chrome managed through the Google Admin console (also ChromeOS). |
| `recommended-policy.json` | The same values as a plain object. |

**Not verified:** these formats follow the browsers' published documentation and were checked by `scripts/check-policy.js` and tests, not on a managed device. After deploying, open `chrome://policy` or `edge://policy` and check every Agent Buddy key shows the status OK. The browser's `ExtensionSettings` (`runtime_blocked_hosts` / `runtime_allowed_hosts`) can also limit where any extension acts; its behaviour for requests from extension pages is not verified.

### The enterprise build

For the strongest setup, compile your hosts and policy into the extension.

```
npm run build:enterprise -- enterprise/<name>.json        # writes dist-enterprise/
node build.js --enterprise enterprise/<name>.json --out <folder>
node build.js --browser firefox --enterprise enterprise/<name>.json   # writes dist-firefox-enterprise/
```

Copy `enterprise/example.json`, write your instances, AI endpoint and policy. The config uses the policy keys, plus: `allowedInstances` (required, exact https addresses, no wildcards or paths, at most 50), `aiProvider` (required), `aiBaseUrl` (required for `azure` and `custom`), `label` (shown next to the version), `updateUrl` (for a self-hosted build) and `$comment`. The build stops with a message on anything else: an unknown key, a wrong type, a non-canonical address, a wildcard, plain http to anything but this computer, a feature id that does not exist, `piiMode: local-only` with a non-local endpoint, or `providedApiKey` (a key compiled into a build can be read by anyone with the build).

| Topic | Normal build | Enterprise build |
| --- | --- | --- |
| Host access | None at install; optional `https://*/*` and localhost, granted one host at a time when a person turns a site on | `host_permissions`: exactly your instances and your AI host; no optional hosts, so the extension cannot ask for any other site |
| Extension-page `connect-src` | `https: http://localhost:* http://127.0.0.1:*` | exactly the AI origin |
| Policy | The browser's managed policy only | The config's policy compiled in as a floor; the managed policy can only make it stricter |

How the two policies combine: allow-lists are intersected (instances, models), block-lists are joined (features, tables, fields, prefixes), modes take the stricter value (for `keyStorage`: `local`, then `encrypted`, then `session`), the smaller daily budget wins, `disablePageBar` holds if either says so, and the switches that loosen something (`allowHrContent`, `coachingEnabled`, `auditExport`) hold only when both allow it. So an enterprise build that should allow HR content must say `"allowHrContent": true` itself. If the managed policy names a different AI provider or address than the build, no AI call is made and the person is told to ask their administrator.

A person still turns Agent Buddy on for each instance once ("Turn on for this site"). Check a build with `npm run repro -- --enterprise enterprise/<name>.json` (builds twice and compares every file).

### Self-hosted install (Chrome and Edge)

This is for when Agent Buddy is not in the Chrome Web Store or Edge Add-ons. `scripts/selfhost.js` makes the files.

**You need:** managed computers (Windows joined to a domain or enrolled in Intune, macOS enrolled in an MDM, or a browser enrolled in Chrome Browser Cloud Management or Edge management; on an unmanaged Windows or Mac the browser refuses); an https address with a certificate the browsers trust; Chrome 116 or later or current Edge.

1. Once: `node scripts/selfhost.js init` writes `selfhost/agentbuddy-key.pem` and prints the extension id. The key decides the id and who may publish an update. Back it up privately, keep it off the web server and out of the repository. Lose it and the id changes.
2. Every release: raise `version` in `manifest.json` and `package.json`; build (`npm run build` or `npm run build:enterprise -- enterprise/<name>.json`); pack with `node scripts/selfhost.js pack --base-url https://extensions.corp.example/agentbuddy --dist dist-enterprise` (or `--dist dist`). It writes `selfhost/out/`: `agentbuddy-<version>.crx`, `update.xml`, `policies/` (the policy files with your id and update address filled in), `SHA256SUMS`.
3. Upload the `.crx` and `update.xml`. Keep older `.crx` files for a while.
4. The first time only: deploy the policy files (they already hold the `ExtensionInstallForcelist` line). Browsers find the new version within hours (Chrome checks about every five hours).
5. Check: open `chrome://policy`, press Reload policies, then `chrome://extensions`: Agent Buddy shows "Installed by your administrator". `node scripts/selfhost.js verify <file.crx>` shows the same id for the package you uploaded. Pilot with a few agents first.

**Not verified:** the package matches what Chrome's own `--pack-extension` makes and tests check the signature and the id; the install on a managed computer and the update poll were not tried.

### Firefox differences

Agent Buddy for Firefox is the same extension built for Firefox 128 or later (`node build.js --browser firefox` writes `dist-firefox/`; add-on id `agentbuddy@agentbuddy`). It is new and not yet checked on a real instance.

| Topic | Firefox |
| --- | --- |
| The panel | Firefox's sidebar, opened by the toolbar button (or Alt+Shift+1; Control+Shift+1 on a Mac). Firefox shows the sidebar next to every tab and does not let an extension close it, so Agent Buddy cannot keep the panel to ServiceNow tabs as it does in Chrome and Edge: close it when you move to another page. |
| The bar on the page | A click on the bar cannot open the sidebar. When it is closed the bar says "Click the Agent Buddy button in your browser toolbar. The action starts in the panel." The action starts if the panel is opened within 30 seconds. |
| Shortcuts | Changed in `about:addons`, gear icon, Manage Extension Shortcuts. |
| Signing | Release and Beta Firefox install only add-ons signed by Mozilla. An unsigned build installs only in ESR, Developer Edition or Nightly with `xpinstall.signatures.required` set to false. Signing is done on addons.mozilla.org by a person with your organisation's account ("On your own" for a self-hosted, unlisted one); no script signs for you. A temporary add-on (`about:debugging`) goes when Firefox closes. |
| Which Firefox | 128 or later; ESR 128, 140 and 153 are new enough, but only ESR 153 still gets security fixes. |
| Policy files | `firefox-windows.reg` (HKLM\\SOFTWARE\\Policies\\Mozilla\\Firefox), `firefox-macos.mobileconfig`, `firefox-policies.json` (as `policies.json` in `/etc/firefox/policies/`, a `distribution` folder next to `firefox.exe`, or `Firefox.app/Contents/Resources/distribution/`), in `docs/review-pack/policies-firefox/`. `ExtensionSettings` installs the add-on (`force_installed`, `install_url`, `update_url`, `default_area: navbar`) and `3rdparty\Extensions` holds the Agent Buddy policy. Use one route per computer. `ExtensionSettings` is one policy for every add-on: add the Agent Buddy entry to yours, do not replace it. |
| No schema check | Firefox does not support `managed_schema.json` and passes every value through as written, so `about:policies` shows no error for a wrong type. Agent Buddy reads true and false only as real `true` and `false`: a registry value of 1 or a macOS `<true/>` would be ignored (`disablePageBar` set to 1 would leave the bar; `aiEnabled` set to 0 would leave AI on). That is why the `.reg` file and the profile carry the policy as one JSON text. |
| Changes need a restart | Firefox reads the policy when it starts. After a change, restart Firefox. |
| Check it | After a restart open `about:policies`: "Active Policies" lists `ExtensionSettings` and `3rdparty`; "Errors" lists what Firefox could not read. Then open Agent Buddy's Settings: each fixed setting shows "Set by your organisation". `scripts/check-policy.js` does not read the Firefox files yet; save the object under `3rdparty` > `Extensions` > `agentbuddy@agentbuddy` as a `.json` file and run it on that. |
| Sites with a port | Firefox match patterns cannot name a port, so a site whose address has a port cannot be turned on. ServiceNow instances have no port. |
| Storage | In Firefox a content script can read `storage.local` (settings, activity log, usage counts), though never the AI key (docs/security.md, limit 17). |
| Load warnings | Firefox ignores `storage.managed_schema` and `version_name` and loads the add-on with a warning for each. |
| Open decision | addons.mozilla.org requires `data_collection_permissions` for a new submission; what to declare is not decided yet. |

Nothing Firefox-specific was tried on a managed computer or signed on AMO.

## Troubleshooting

Find the message or symptom below to see its likely cause and what to do; where a cause is not certain, the row says so.

The causes come from the messages the code shows and from the project's documents.

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| The side panel does not appear on a ServiceNow tab (Chrome, Edge) | The panel is off by default and on only for tabs on a site you added (or your organisation listed). | Click the Agent Buddy toolbar button on the ServiceNow tab, then "Turn on for this site". Or add the address in Settings > Basics > ServiceNow sites. |
| "Open your ServiceNow site in this tab, then click the Agent Buddy button in the browser toolbar." | You are on a page that is not an added site. | Open your ServiceNow site in this tab and click the toolbar button. A click on the toolbar button on a page that is not an added site opens Settings at ServiceNow sites. |
| "This does not look like ServiceNow." / "Agent Buddy could not check this page." | The page check did not find ServiceNow's marks (it looks for `g_ck`, `window.NOW` and ServiceNow script names). | If it really is ServiceNow, press "Turn on anyway". |
| "Your organisation has not approved this site for Agent Buddy." / "Your organisation has not approved this site." | The policy `allowedInstances` does not list the site. | Ask your administrator to add it. |
| "The browser did not turn Agent Buddy on for this site. Press Turn on again and choose Allow. If no question appears, your organisation may block it: ask your administrator." | You refused the browser's permission question, or the browser blocks it by policy. | Press "Turn on" again and choose Allow; otherwise ask your administrator. |
| "This build of Agent Buddy cannot be turned on for that site. Your organisation decides which ServiceNow sites it works on." | An enterprise build has fixed host access. | Ask your administrator for a build that includes the site. |
| "Add your AI key in Settings first." / "Add your AI key in Settings to use AI." | No key saved for the provider in use. | Settings > AI Assist: paste the key, press "Save key", then "Test connection". For Ollama no key is needed. |
| "Choose an AI model in Settings first." / "Enter the name of your Azure deployment in Settings first." | No model (or deployment) is set. | Settings > AI Assist > Model (or Deployment name). |
| "A key is saved but locked. Unlock it above with your passphrase." | The key is encrypted and this browser session has not unlocked it. | Enter the passphrase under "Passphrase to unlock the saved key" and press "Unlock". A forgotten passphrase cannot be recovered: enter the key again. |
| The key is gone after you closed the browser | "Memory only" keeps it in memory and forgets it on close ("You enter it again next time."). | Enter it again, or choose another place in Settings if your organisation allows it. |
| "{who} did not accept the AI key. Check it in Settings." | The provider refused the key (wrong, expired, or for another provider). | Check the key and provider; use "Test connection". |
| "... could not find this model" / "... could not find this deployment. Check the AI address and the deployment name in Settings." | Wrong model id or Azure deployment name, or wrong address. | Check the model or deployment name and the AI address. For Azure the name is the deployment's, not the model's. |
| "... says the account has no credit left ... Add credit on the AI company's site, then try again." | The provider account has no credit or quota. | Add credit with the provider. |
| "... is limiting requests ... Try again in {wait}." / "... is busy. Try again in a minute." / "... gave up waiting" / "did not answer within ..." | The provider is limiting, busy or slow (Agent Buddy retries at most twice, only on 429, 503 and 529). | Wait and try again; for a slow answer choose a faster model. |
| "Could not reach the AI service at {host}. Check your internet connection or VPN, then try again. If it keeps happening, ask your administrator." | The AI address cannot be reached from this computer. | Check the connection or VPN, the address, and (for a local model) that the server is running. |
| "{who} turned this request down with its content filter." | The provider's content filter. | Change the text, or ask your administrator about the filter. |
| "The AI address is not valid: ..." / "Enter the address of your AI server in Settings first." | The address is not https (or localhost), carries a user name or query, or is empty for "Other". A policy `aiBaseUrl` that is not valid blocks every AI call. | Fix the address in Settings; if your organisation set it, tell your administrator. |
| "Your organisation only allows the "{name}" AI service." / "Your organisation allows these AI services only: ..." / "Your organisation allows these models only: ..." / "Your organisation requires its own AI service. Use the address set by your administrator." | The policy pins the provider, models or address. | Use what the message names, or ask your administrator. |
| "Your organisation has switched AI Assist off." / "Your organisation has switched this feature off." | `aiEnabled` is false, or the feature id is in `disabledFeatures`. | Insights still works. Ask your administrator if you need the feature. |
| "Your privacy mode only allows an AI model running on this computer. Choose Ollama or another local server in Settings." | The privacy mode is "Local model only" (yours or your organisation's floor). | Choose a local model, or ask your administrator about the floor. |
| "This needs {mode} privacy mode. Change it in Settings." / "HR tickets need Strict privacy mode (or Local-only)." | The action or an HR record needs a stricter mode than the one set. | Settings > Basics > Privacy > "Personal-data protection". |
| "HR case content is not sent to an AI model unless your organisation allows it. Ask your administrator." / "HR case content can only go to an AI service your organisation has approved." | `allowHrContent` is false, or the endpoint is not pinned. | Ask your administrator. |
| "Your organisation does not allow Agent Buddy to use {type}." / "...to read X records" | The table is in `blockedTables`. | Ask your administrator if this is not intended. |
| "Your organisation's daily AI limit has been reached. It resets tomorrow." (or your own limit) | The daily token budget (`tokenBudgetPerDay` or your own) is used up. | Wait until tomorrow, or raise your own limit in Settings > AI Assist > Usage and limits (your organisation's limit cannot be raised there). The count is per computer, so another browser profile has its own count. |
| "This ticket is too long to send to the AI in one go, even with only the newest note." | The request is larger than the model reads. | "Choose a model that reads more in Settings." On a local model: "Choose an AI model that is not on this computer." |
| "The final check still found unmasked data (...), so nothing was sent." / "A value that should be masked is still in the text, so nothing was sent." / "Redaction failed, so nothing was sent." | The privacy filter fails closed rather than send something it cannot clean. | Hide the value in the check sheet ("Hide something else"), edit the text, or leave it out under "What goes in", then try again. |
| 'Strict mode: the field "..." is sensitive and is never sent.' / "Strict mode: free text from HR tables is not sent." / 'The field "..." is blocked by policy, so nothing was sent.' | Strict mode refuses sensitive fields and HR free text; or the field is in `blockedFields`. | Use "Use Strict privacy for this one" only where you need it, or work without that action on this record. |
| Insert is disabled, or "This was written for INC0010001. Open that ticket again, or use Copy." | You opened another ticket after the draft was written. | Open that ticket again, or use Copy. |
| "Agent Buddy cannot read the form on this page (Workspace and portal pages keep it out of reach)." / Insert falls back to Copy | Workspace and portal forms keep their fields out of reach (shadow DOM). Not verified on every real Workspace. | Paste the text or use Copy, and press Save yourself. |
| A list is empty, or "{thing}: not available to you." | Your roles do not let you read it. ServiceNow can also answer an unreadable table with no rows rather than an error, so "none found" cannot be told from "hidden". | Ask your ServiceNow administrator if you need access; Agent Buddy never works around a refusal. |
| "{thing}: your organisation does not let Agent Buddy read this." | `blockedTables` (blocked tables are enforced when data is read). | Ask your administrator. |
| A policy change has no effect (Chrome, Edge) | The browser rejected a value that does not match `managed_schema.json`, or the policy was not reloaded. | Open `chrome://policy` or `edge://policy`, press Reload policies, and look for errors on the Agent Buddy keys. Run `node scripts/check-policy.js` on the file. |
| A policy change has no effect (Firefox) | Firefox reads the policy only when it starts, and checks no types (a true written as 1 is ignored). | Restart Firefox, open `about:policies`, and write true and false as real JSON booleans. |
| The bar on ServiceNow pages is missing | You switched it off ("Show the bar on ServiceNow pages"), `disablePageBar` is true, the site is not turned on, or the table is blocked. | Turn it on in Settings > Basics > Side rail, or ask your administrator. |
| Firefox: the bar says "Click the Agent Buddy button in your browser toolbar. The action starts in the panel." | Firefox does not let a click on a page open the sidebar. | Click the toolbar button within 30 seconds; the action starts in the panel. |
| Firefox: the site cannot be turned on | The address has a port. Firefox match patterns cannot name one. | Not possible in Firefox; ServiceNow instances normally have no port. |
| A keyboard shortcut shows "Not set" or does nothing | The browser has none set for it (or another extension holds the key). | Settings > Basics > Keyboard shortcuts > "Change the shortcuts in the browser". |
| "Export is switched off by your organisation." (Activity log) | `auditExport` is false. | Ask your administrator. |
| "Something went wrong. Try again; if it keeps happening, tell your administrator." | A generic failure with no more specific message. | Try again. If it repeats, Settings > Basics > Help from support > "Copy diagnostics" and send the text (no key, no ticket content) to support. |
| Snippets are missing on another computer | Snippets are stored in this browser profile only. | On the first computer: Write > Snippets > Back up or share > "Save to a file"; on the other: "Add from a file". |
