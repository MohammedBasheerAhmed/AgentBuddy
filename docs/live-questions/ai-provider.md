# Live questions: AI providers, company gateways, Azure OpenAI and model switching

Nothing here has run against a real gateway or a real vendor API (the end-to-end suite uses a stub; the unit tests use recorded
shapes). Check each with a real key.

## Company gateway (the "OpenAI / company gateway" provider)

1. **The address.** Enter the base address your company gave out (the value of `OPENAI_BASE_URL`, usually ending in `/v1`) in
   "Address". Agent Buddy adds `/chat/completions` to it, as the OpenAI libraries do. Check: Settings > Test connection says
   "Connected". If it says "answered "not found" (404)", the address is probably missing or has an extra path segment.
2. **Azure-style addresses** now have their own provider: see "Azure OpenAI" below. If an `*.openai.azure.com` address is typed into
   the gateway provider, Settings says to choose "Azure OpenAI" instead (the gateway provider sends `Authorization: Bearer`, which an
   Azure key does not use).
3. **The model name.** Type it exactly as given (for example `gpt-5-mini-preprod`). Any name is accepted; names that start with
   `gpt-5` or `o` plus a digit (also after a vendor prefix such as `openai/gpt-5`) are sent without a `temperature`. If a server still
   answers 400 naming `temperature`, `max_tokens` or `max_completion_tokens`, Agent Buddy leaves that field out and sends once more
   (each field at most once). Check that a normal Summarise works.
4. **Load models from the server.** Sends `GET <address>/models` with only the key. Check: does your gateway answer it, and does the
   list contain the models your key may use? If it answers 404 or an empty list, the panel says so and the typed name still works.
5. **Switching in the panel header.** The selector in the side panel header lists the model in use, the loaded list and the
   provider's own models. Check that a switch is used by the next run (the activity log in Settings shows the model of each run).
   When managed policy sets `allowedModels`, the list is cut to those and the selector is locked ("Allowed by your organisation").
6. **Permission prompt.** The first Test connection or Load models asks the browser for permission to contact the gateway's host.
   Allow it; if the prompt never appears the error reads "Could not reach <host>". In the enterprise build the AI address is granted at
   install, so no prompt appears; any other address is refused with "This build of Agent Buddy cannot contact <host>". **Unverified**
   on a real enterprise install: that `permissions.contains` is true for the baked host and that `permissions.request` for another host
   fails rather than prompting.

## Azure OpenAI (provider "Azure OpenAI")

Settings asks for: the **resource address** (`https://<name>.openai.azure.com`, the "Endpoint" on "Keys and Endpoint"), **how to
call it** (v1 API, the default, or the classic deployment address with an api-version), the **API version** (classic form only;
default `2024-10-21`), the **deployment name** (sent as the model), and optionally **other deployments** to switch between in the panel.
The key is sent in the `api-key` header only (never `Authorization`), only to that resource. A whole Target URI pasted into the address
box (`.../openai/deployments/<name>/chat/completions?api-version=...`) is split into the fields; any other query is refused.

7. **v1 form.** Agent Buddy sends `POST <resource>/openai/v1/chat/completions` with `api-key: <key>` and `"model": "<deployment>"`,
    `max_completion_tokens: 16000`. **Unverified:** that every resource (including ones created before the v1 API) answers this form
    with an API key, and that the deployment name (not the model name) is what `model` must hold. Check: Test connection with the v1
    form. If it answers 404, switch "How to call it" to the deployment address.
8. **Classic form.** `POST <resource>/openai/deployments/<deployment>/chat/completions?api-version=2024-10-21`. **Unverified:** that
    `2024-10-21` (the newest GA version we know of) accepts `max_completion_tokens`. If the resource answers 400 naming it, Agent Buddy
    drops the field and sends again (no output limit then). Check: Test connection, then the activity log shows `sent`. If your
    organisation uses another version, type it (format `YYYY-MM-DD` or `YYYY-MM-DD-preview`).
9. **No "Load models" for Azure.** Azure gives an API key no list of *deployments* (`GET /openai/models` lists base models, which are
    not what the requests need; listing deployments needs the management API and an Azure sign-in). Settings hides the button and
    asks for the deployment names instead. **Unverified:** whether `GET /openai/v1/models` on your resource lists deployment names; if it
    does, tell us and the list can be offered.
10. **Content filter.** A prompt Azure's filter refuses comes back as 400 with code `content_filter`; a filtered answer comes back with
    `finish_reason: "content_filter"`. Agent Buddy shows "turned this request down with its content filter" or marks the answer as cut
    off. Check with your resource's filter settings; the exact shapes are **unverified**.
11. **API Management in front of Azure.** A gateway address such as `https://corp-apim.azure-api.net/aoai` is accepted (Settings says it
    is not an `openai.azure.com` address, which is fine). **Unverified:** whether your APIM policy expects the key in `api-key` (what
    Agent Buddy sends) or in `Ocp-Apim-Subscription-Key` (not supported).
12. **Policy.** `aiProvider: "azure"` with `aiBaseUrl` set to the resource address pins it; `allowedModels` then names deployments. Check
    that the pinned address in Settings is read-only and that Test connection works.

## Every provider: time limits, retries, cancel, wording

13. **Time limit.** A request has 2 minutes (5 for a model on this computer; 45 seconds for Test connection; 20 seconds for the model
    list). After that it is stopped and not sent again; the message says it did not answer in time. Check: a long KB draft on the
    slowest model you allow finishes inside 2 minutes.
14. **Retries.** Only 429, 503 and 529 are tried again: at most 3 tries in all, waiting what `retry-after` / `retry-after-ms` asks (up to
    20 seconds; a longer wait is reported, not waited for), otherwise 1 s then 2 s. `x-should-retry: false` and a used-up quota
    (`insufficient_quota`) are not retried. Check one real rate-limit answer from your provider.
15. **Cancel.** Settings has a Cancel button for Test connection and Load models. The side panel can only cancel the AI request once
    the run pipeline passes its signal through (see the lead's notes); until then a cancelled run's answer is dropped, not stopped.
16. **Error text.** Messages are short and name the provider; the provider's own reason is shown only when it is JSON, with anything
    shaped like a key hidden, and never when it repeats part of what was sent. Check one real 400 and one real 401 from each provider you
    allow.
17. **Answers cut short.** `stop_reason: "max_tokens"` (Claude) and `finish_reason: "length"` (OpenAI-style) set `truncated` on the reply,
    with the sentence "The answer was cut short...". Settings shows it after Test connection; the side panel shows it once the pipeline
    passes it on.

## Preset defaults (check against each vendor's current list)

18. Anthropic: `claude-sonnet-5-5` (default), `claude-haiku-5-5`, `claude-opus-5-5`; requests send `output_config.effort: "low"` and no
    sampling parameters. Gemini `gemini-2.5-flash`, Mistral `mistral-large-latest`, Groq `llama-3.3-70b-versatile`, DeepSeek
    `deepseek-chat`, OpenRouter `anthropic/claude-sonnet-5.5` (OpenRouter writes the minor version with a dot; **unverified** that this
    id exists there), Ollama `llama3.1`. **Unverified:** that the Gemini, Groq and Mistral defaults have not been retired. Every preset
    except Anthropic and Azure can load the server's list, and any name can be typed.

## DeepSeek

19. **Real API.** Provider "DeepSeek", address fixed to `https://api.deepseek.com/v1`, default model `deepseek-chat`;
   `deepseek-reasoner` is listed and any other name can be typed. A new account with no balance answers 402; Agent Buddy shows "the
   account has no balance left" with DeepSeek's own reason. No output limit is sent (DeepSeek refuses one above 8192). Check one real
   Summarise.
20. **Data residency.** DeepSeek's own hosted API is operated from China. See `docs/deployment.md` before allowing it organisation-wide.

## Links in lists

21. **Right-click on a ticket link in the real side panel** should show the browser's "Open link in new tab". Ctrl+click and
   middle-click are tested headless; a context menu cannot be. Check it in Chrome and in Edge.

## Where the key is kept

22. **The vault.** A key kept "in this browser" (and an encrypted one) now lives in Agent Buddy's own IndexedDB database
    (`agentbuddy_vault`), which content scripts cannot open, instead of `chrome.storage.local`, which they can. A key saved by an earlier
    version is moved there the first time it is read. **Unverified** on a real browser profile: that the move happens once and that the
    side panel picks up a key saved in Settings (it listens for the time stamp `agentbuddy_keyvault_stamp`). Check: save a key in
    Settings, run Summarise in an open panel without reopening it.
23. **`setAccessLevel`.** The extension pins `chrome.storage.session` to `TRUSTED_CONTEXTS` when it opens the key store. **Unverified:**
    that Edge accepts the call from an extension page (if not, it fails quietly and the browser default, the same level, stays).
