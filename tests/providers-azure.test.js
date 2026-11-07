import test from 'node:test';
import assert from 'node:assert/strict';
import { sendChat } from '../src/providers/index.js';
import { resolveProviderConfig, PROVIDERS, providerName } from '../src/providers/config.js';
import { listModels, canListModels } from '../src/providers/models.js';
import { createFirewall } from '../src/pii/index.js';
import { splitAzureAddress, azureChatUrl, azureOptions, AZURE_DEFAULT_API_VERSION, isAzureHost, validateBaseUrl } from '../src/lib/aiUsage.js';
import { aiOriginPattern, ensureAiPermission } from '../src/lib/aiPermission.js';
import { modelChoices } from '../src/lib/modelChoices.js';
import { connectionProblem } from '../src/lib/pipeline.js';
import { checkProviderAllowed, normalizePolicy } from '../src/policy/policy.js';
import { isAiReady, aiNeeds, aiNeedsText } from '../src/sidepanel/aiReady.js';

// Azure OpenAI: the resource address, the deployment as the model, the key in an api-key header, the v1 form and the classic
// deployment form with an api-version. Nothing here reaches a network.

const sealed = () =>
  createFirewall({ mode: 'standard', people: [] }).buildRequest({
    feature: 'record-summary',
    table: 'incident',
    system: 'Summarise.',
    parts: [{ field: 'short_description', label: 'Short description', text: 'VPN fails' }],
  });
const OK = { choices: [{ message: { role: 'assistant', content: 'Summary.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
function recorder(...answers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null, method: init.method });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)] || { status: 200, body: OK };
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  fn.calls = calls;
  return fn;
}
const azure = (over = {}) => ({ provider: 'azure', baseUrls: { azure: 'https://contoso.openai.azure.com' }, models: { azure: 'gpt-5-mini-prod' }, ...over });

test('Azure is a provider of its own, with a key that goes in api-key, no default deployment and no list call', () => {
  const def = PROVIDERS.azure;
  assert.equal(def.api, 'openai');
  assert.equal(def.azure, true);
  assert.equal(def.defaultModel, '');
  assert.equal(canListModels('azure'), false);
  assert.equal(canListModels('openai'), true);
  assert.equal(canListModels('anthropic'), false);
  assert.ok(!/Azure/.test(PROVIDERS.openai.label), 'the gateway provider no longer claims to be Azure');
  assert.equal(providerName(resolveProviderConfig(azure(), 'k')), 'Azure OpenAI');
});

test('resolveProviderConfig: the v1 form by default, the default api-version, and plain problems for what is missing or wrong', () => {
  const cfg = resolveProviderConfig(azure(), 'k');
  assert.equal(cfg.baseUrl, 'https://contoso.openai.azure.com');
  assert.equal(cfg.model, 'gpt-5-mini-prod');
  assert.deepEqual(cfg.azure, { form: 'v1', apiVersion: AZURE_DEFAULT_API_VERSION });
  assert.equal(cfg.invalidBaseUrl, '');
  assert.equal(cfg.keyOptional, false);
  assert.equal(cfg.local, false);

  assert.match(resolveProviderConfig({ provider: 'azure' }, 'k').invalidBaseUrl, /needs the address of your resource/);
  assert.match(connectionProblem(resolveProviderConfig({ provider: 'azure' }, 'k')), /needs the address of your resource/, 'every send refuses it');
  assert.match(resolveProviderConfig(azure({ azure: { form: 'deployment', apiVersion: 'latest' } }), 'k').invalidBaseUrl, /API version must look like/);
  assert.match(resolveProviderConfig(azure({ models: { azure: 'my deployment' } }), 'k').invalidBaseUrl, /deployment name may only use/);
  assert.match(resolveProviderConfig(azure({ baseUrls: { azure: 'http://contoso.openai.azure.com' } }), 'k').invalidBaseUrl, /https/);
  assert.match(resolveProviderConfig(azure({ baseUrls: { azure: 'https://contoso.openai.azure.com/?api-version=2024-10-21' } }), 'k').invalidBaseUrl, /anything after the address/);
  assert.deepEqual(azureOptions({ form: 'nonsense', apiVersion: ' 2025-04-01-preview ' }), { form: 'v1', apiVersion: '2025-04-01-preview', apiVersionOk: true });
});

test('the v1 form: <resource>/openai/v1/chat/completions, the key in api-key only, the deployment as the model', async () => {
  const fetchFn = recorder();
  const out = await sendChat(resolveProviderConfig(azure(), 'azure-key-1234567890'), sealed(), { skipBudget: true, fetchFn });
  assert.equal(out.content, 'Summary.');
  const [call] = fetchFn.calls;
  assert.equal(call.url, 'https://contoso.openai.azure.com/openai/v1/chat/completions');
  assert.equal(call.headers['api-key'], 'azure-key-1234567890');
  assert.ok(!('Authorization' in call.headers), 'no Bearer header: the key goes only where Azure expects it');
  assert.equal(call.body.model, 'gpt-5-mini-prod');
  assert.equal(call.body.max_completion_tokens, 16000, 'Azure takes max_completion_tokens (its reasoning models refuse max_tokens)');
  assert.ok(!('max_tokens' in call.body));
  assert.ok(!JSON.stringify(call.body).includes('azure-key'), 'the key is not in the body');
});

test('the classic form: /openai/deployments/<deployment>/chat/completions with only the api-version Agent Buddy adds', async () => {
  const fetchFn = recorder();
  const cfg = resolveProviderConfig(azure({ azure: { form: 'deployment' } }), 'k-123456');
  await sendChat(cfg, sealed(), { skipBudget: true, fetchFn });
  const url = new URL(fetchFn.calls[0].url);
  assert.equal(url.origin, 'https://contoso.openai.azure.com');
  assert.equal(url.pathname, '/openai/deployments/gpt-5-mini-prod/chat/completions');
  assert.deepEqual([...url.searchParams.keys()], ['api-version']);
  assert.equal(url.searchParams.get('api-version'), AZURE_DEFAULT_API_VERSION);

  const pinned = resolveProviderConfig(azure({ azure: { form: 'deployment', apiVersion: '2025-04-01-preview' } }), 'k');
  assert.equal(azureChatUrl(pinned.baseUrl, pinned.azure, pinned.model), 'https://contoso.openai.azure.com/openai/deployments/gpt-5-mini-prod/chat/completions?api-version=2025-04-01-preview');
});

test('a resource address typed with /openai or /openai/v1 (as Azure pages show it) is not doubled', () => {
  for (const typed of ['https://contoso.openai.azure.com/openai', 'https://contoso.openai.azure.com/openai/v1/', 'https://contoso.openai.azure.com/']) {
    const cfg = resolveProviderConfig(azure({ baseUrls: { azure: typed } }), 'k');
    assert.equal(azureChatUrl(cfg.baseUrl, cfg.azure, cfg.model), 'https://contoso.openai.azure.com/openai/v1/chat/completions', typed);
  }
  // An API Management gateway in front of Azure keeps its own path.
  const apim = resolveProviderConfig(azure({ baseUrls: { azure: 'https://corp-apim.azure-api.net/aoai' } }), 'k');
  assert.equal(azureChatUrl(apim.baseUrl, apim.azure, apim.model), 'https://corp-apim.azure-api.net/aoai/openai/v1/chat/completions');
  assert.equal(isAzureHost('corp-apim.azure-api.net'), true);
  assert.equal(isAzureHost('contoso.openai.azure.com'), true);
  assert.equal(isAzureHost('evil.example'), false);
});

test('splitAzureAddress: a pasted Target URI becomes its parts; anything but api-version after ? is refused', () => {
  assert.deepEqual(splitAzureAddress('https://contoso.openai.azure.com/openai/deployments/gpt-4o-prod/chat/completions?api-version=2024-10-21'), {
    ok: true,
    base: 'https://contoso.openai.azure.com',
    form: 'deployment',
    deployment: 'gpt-4o-prod',
    apiVersion: '2024-10-21',
  });
  assert.deepEqual(splitAzureAddress('https://contoso.openai.azure.com/openai/v1/'), { ok: true, base: 'https://contoso.openai.azure.com', form: 'v1', deployment: '', apiVersion: '' });
  assert.equal(splitAzureAddress('https://contoso.openai.azure.com'), null, 'a plain resource address has nothing to split');
  assert.equal(splitAzureAddress(''), null);
  assert.match(splitAzureAddress('https://contoso.openai.azure.com/openai/deployments/x/chat/completions?api-version=2024-10-21&foo=1').error, /Only api-version/);
  assert.match(splitAzureAddress('http://contoso.openai.azure.com/openai/v1').error, /https/);
  assert.match(splitAzureAddress('https://user:pw@contoso.openai.azure.com/openai/v1').error, /user name or password/);
  assert.match(splitAzureAddress('https://contoso.openai.azure.com/openai/deployments/x/chat/completions?api-version=soon').error, /api-version/);
  assert.match(splitAzureAddress('https://contoso.openai.azure.com/openai/deployments/a%20b/chat/completions').error, /deployment name/);
  // The split address is one validateBaseUrl accepts.
  assert.equal(validateBaseUrl(splitAzureAddress('https://contoso.openai.azure.com/openai/v1').base).ok, true);
});

test('the browser permission is asked for the Azure resource host only, never a wildcard; nothing for an incomplete set-up', async () => {
  assert.equal(aiOriginPattern(resolveProviderConfig(azure(), 'k')), 'https://contoso.openai.azure.com/*');
  assert.equal(aiOriginPattern(resolveProviderConfig({ provider: 'azure' }, 'k')), '');
  assert.equal(aiOriginPattern(resolveProviderConfig({ provider: 'openai', baseUrls: { openai: 'ftp://x' } }, 'k')), '', 'a bad address asks for nothing');
  const asked = [];
  const permissions = { contains: async () => false, request: async ({ origins }) => (asked.push(...origins), true) };
  await ensureAiPermission(resolveProviderConfig(azure(), 'k'), permissions);
  assert.deepEqual(asked, ['https://contoso.openai.azure.com/*']);
  const refused = { contains: async () => false, request: async () => false };
  await assert.rejects(() => ensureAiPermission(resolveProviderConfig(azure(), 'k'), refused), /permission to contact contoso\.openai\.azure\.com\. Nothing was sent\./);
  // A build with fixed hosts (enterprise): its own AI address is already granted, nothing is asked; another address cannot even be asked.
  let requests = 0;
  const fixed = { contains: async ({ origins }) => origins[0] === 'https://contoso.openai.azure.com/*', request: async () => { requests += 1; throw new Error('Only permissions specified in the manifest may be requested.'); } };
  await ensureAiPermission(resolveProviderConfig(azure(), 'k'), fixed);
  assert.equal(requests, 0, 'granted at install: no prompt');
  await assert.rejects(
    () => ensureAiPermission(resolveProviderConfig(azure({ baseUrls: { azure: 'https://other.openai.azure.com' } }), 'k'), fixed),
    (err) => /^This build of Agent Buddy cannot contact other\.openai\.azure\.com\./.test(err.message) && !/manifest/.test(err.message)
  );
});

test('Load models is not offered for Azure, and says why if called; the deployments typed in Settings feed the panel switch', async () => {
  let fetched = 0;
  await assert.rejects(() => listModels(resolveProviderConfig(azure(), 'k'), async () => { fetched += 1; return new Response('{}'); }), /does not give a key a list of your deployments/);
  assert.equal(fetched, 0);
  const choices = modelChoices({ def: PROVIDERS.azure, current: 'gpt-5-mini-prod', loaded: ['gpt-5-prod', 'gpt-5-mini-prod'] });
  assert.deepEqual(choices.map((c) => c.id), ['gpt-5-mini-prod', 'gpt-5-prod'], 'two choices: the panel shows a switch');
  const limited = modelChoices({ def: PROVIDERS.azure, current: 'gpt-5-prod', loaded: ['gpt-5-prod', 'gpt-5-mini-prod'], allowed: ['gpt-5-prod'] });
  assert.deepEqual(limited.map((c) => c.id), ['gpt-5-prod'], 'policy allowedModels names deployments');
});

test('policy: aiProvider azure with the resource as aiBaseUrl lets the matching set-up through and nothing else', () => {
  const policy = normalizePolicy({ aiProvider: 'azure', aiBaseUrl: 'https://contoso.openai.azure.com/', allowedModels: ['gpt-5-mini-prod'] });
  assert.equal(checkProviderAllowed(resolveProviderConfig(azure(), 'k'), policy).ok, true);
  assert.equal(checkProviderAllowed(resolveProviderConfig(azure({ baseUrls: { azure: 'https://other.openai.azure.com' } }), 'k'), policy).ok, false);
  assert.equal(checkProviderAllowed(resolveProviderConfig({ provider: 'openai' }, 'k'), policy).ok, false);
});

test('an incomplete Azure set-up is refused before anything is fetched', async () => {
  const fetchFn = recorder();
  await assert.rejects(() => sendChat(resolveProviderConfig({ provider: 'azure', models: { azure: 'x' } }, 'k'), sealed(), { skipBudget: true, fetchFn }), /needs the address of your resource/);
  await assert.rejects(() => sendChat(resolveProviderConfig({ provider: 'azure', baseUrls: { azure: 'https://contoso.openai.azure.com' } }, 'k'), sealed(), { skipBudget: true, fetchFn }), /name of your Azure deployment/);
  assert.equal(fetchFn.calls.length, 0);
});

test('the panel knows an incomplete Azure set-up: the buttons say what to finish instead of failing later', () => {
  const eff = (values, over = {}) => ({ values: { provider: 'azure', ...values }, apiKey: 'k', keyLocked: false, policy: normalizePolicy({}), ...over });
  assert.equal(isAiReady(eff(azure())), true);
  assert.equal(isAiReady(eff({})), false);
  assert.equal(aiNeeds(eff({})), 'setup');
  assert.match(aiNeedsText(eff({}), 'these actions'), /^Finish the AI set-up in Settings to use these actions: Azure OpenAI needs the address/);
  assert.equal(aiNeeds(eff({ baseUrls: { azure: 'https://contoso.openai.azure.com' } })), 'setup', 'no deployment yet');
  assert.equal(aiNeeds(eff({}, { apiKey: '' })), 'add-key', 'the key is asked for first');
});

test('a deployment that refuses temperature or max_completion_tokens: the field is left out and the request sent again, once each', async () => {
  const refuse = (param, message) => ({ status: 400, body: { error: { message, type: 'invalid_request_error', param, code: 'unsupported_parameter' } } });
  const fetchFn = recorder(
    refuse('temperature', "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported."),
    refuse(null, 'Unrecognized request argument supplied: max_completion_tokens'),
    { status: 200, body: OK }
  );
  const out = await sendChat(resolveProviderConfig(azure({ models: { azure: 'prod-chat' } }), 'k'), sealed(), { skipBudget: true, fetchFn });
  assert.equal(out.content, 'Summary.');
  assert.equal(fetchFn.calls.length, 3);
  assert.equal(fetchFn.calls[0].body.temperature, 0.2, 'a deployment name says nothing about the model, so the first try has one');
  assert.ok(!('temperature' in fetchFn.calls[1].body));
  assert.ok(!('max_completion_tokens' in fetchFn.calls[2].body));
  assert.equal(fetchFn.calls[2].body.model, 'prod-chat');

  // A 400 about something else is not retried.
  const other = recorder({ status: 400, body: { error: { message: 'The model does not exist', code: 'DeploymentNotFound' } } });
  await assert.rejects(() => sendChat(resolveProviderConfig(azure(), 'k'), sealed(), { skipBudget: true, fetchFn: other }), (err) => err.code === 'BAD_REQUEST' && /deployment name in Settings/.test(err.message));
  assert.equal(other.calls.length, 1);
});

test("Azure's content filter: a refused prompt (400 content_filter) and a filtered answer are plain messages", async () => {
  const blocked = recorder({ status: 400, body: { error: { message: "The response was filtered due to the prompt triggering Azure OpenAI's content management policy.", code: 'content_filter' } } });
  await assert.rejects(() => sendChat(resolveProviderConfig(azure(), 'k'), sealed(), { skipBudget: true, fetchFn: blocked }), (err) => err.code === 'CONTENT_FILTER' && /content filter/.test(err.message));
  const filtered = recorder({ status: 200, body: { choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'content_filter' }] } });
  await assert.rejects(() => sendChat(resolveProviderConfig(azure(), 'k'), sealed(), { skipBudget: true, fetchFn: filtered }), (err) => err.code === 'CONTENT_FILTER');
  const partial = recorder({ status: 200, body: { choices: [{ message: { role: 'assistant', content: 'Half an ans' }, finish_reason: 'content_filter' }] } });
  const out = await sendChat(resolveProviderConfig(azure(), 'k'), sealed(), { skipBudget: true, fetchFn: partial });
  assert.equal(out.truncated, true);
  assert.equal(out.stopReason, 'content_filter');
});
