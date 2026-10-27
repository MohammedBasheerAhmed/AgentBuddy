# Live questions: AI providers, company gateways and model switching

Nothing here has run against a real gateway or a real vendor API (the end-to-end suite uses a stub). Check each with a real key.

## Company gateway (the "OpenAI / Azure OpenAI / company gateway" provider)

1. **The address.** Enter the base address your company gave out (the value of `OPENAI_BASE_URL`, usually ending in `/v1`) in
   "Address". Agent Buddy adds `/chat/completions` to it, as the OpenAI libraries do. Check: Settings > Test connection says
   "Connected". If it says "request failed (404)", the address is probably missing or has an extra path segment.
2. **Azure-style addresses.** An Azure OpenAI address looks like `https://<name>.openai.azure.com/openai/deployments/<deployment>` and
   needs `?api-version=...` and an `api-key` header instead of `Authorization: Bearer`. Agent Buddy does NOT support that form (an
   address may not carry a `?query`, and the key is always sent as `Bearer`). Many company gateways in front of Azure accept the plain
   OpenAI form, so try that first. If yours does not, say so: an Azure mode is a small addition.
3. **The model name.** Type it exactly as given (for example `gpt-5-mini-preprod`). Any name is accepted; names that start with
   `gpt-5` or `o` plus a digit are sent without a `temperature` (those models reject one). Check that a normal Summarise works.
4. **Load models from the server.** Sends `GET <address>/models` with only the key. Check: does your gateway answer it, and does the
   list contain the models your key may use (the lead said the key can switch models)? If it answers 404 or an empty list, the panel
   says so and the typed name still works. Some gateways list every model in the company, including ones your key cannot call; the
   list is only a convenience.
5. **Switching in the panel header.** The selector in the side panel header lists the model in use, the loaded list and the
   provider's own models. Check that a switch is used by the next run (the activity log in Settings shows the model of each run).
   When managed policy sets `allowedModels`, the list is cut to those and the selector is locked ("Allowed by your organisation").
6. **Permission prompt.** The first Test connection or Load models asks the browser for permission to contact the gateway's host.
   Allow it; if the prompt never appears the error reads "Could not reach <host>".

## DeepSeek

7. **Real API.** Provider "DeepSeek", address fixed to `https://api.deepseek.com/v1`, default model `deepseek-chat`;
   `deepseek-reasoner` is listed and any other name can be typed. A new account with no balance answers 402; Agent Buddy shows "the
   account has no balance left" with DeepSeek's own reason. Check one real Summarise.
8. **Data residency.** DeepSeek's own hosted API is operated from China. See `docs/deployment.md` before allowing it organisation-wide.

## Links in lists

9. **Right-click on a ticket link in the real side panel** should show the browser's "Open link in new tab". Ctrl+click and
   middle-click are tested headless; a context menu cannot be. Check it in Chrome and in Edge.
