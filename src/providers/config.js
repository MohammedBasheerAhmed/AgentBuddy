// Single source of truth for providers and models. Do not hardcode a model name anywhere else in the codebase.
import { validateBaseUrl, azureOptions, isAzureDeployment } from '../lib/aiUsage.js';

export const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_MODEL = 'gpt-5-mini';
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

// Every provider speaks one of two protocols: 'anthropic' (the Messages API) or 'openai' (Chat Completions, which most other
// vendors, gateways and local servers offer too). A preset has a fixed `baseUrl`; `userBaseUrl` means the person (or the
// organisation's policy) may supply one; `freeModel` means the model id is free text, so a new model never needs a release.
// `short` is the name used in messages ("DeepSeek is busy..."). `azure` marks Azure OpenAI: the address is the resource, the model
// is the name of a deployment, and the key goes in an `api-key` header (src/providers/openai.js).
// Summaries and drafts do not need the largest model, so the defaults lean to the fast tier.
export const PROVIDERS = {
  anthropic: {
    api: 'anthropic',
    userBaseUrl: true,
    label: 'Anthropic (Claude)',
    short: 'Anthropic',
    keyLabel: 'Anthropic API key',
    keyHint: 'Starts with sk-ant-. Create one in the Anthropic Console.',
    defaultModel: 'claude-sonnet-5-5',
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 - fast and capable' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 - cheapest' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 - best quality' },
    ],
  },
  openai: {
    api: 'openai',
    userBaseUrl: true,
    label: 'OpenAI / company gateway',
    short: 'OpenAI',
    keyLabel: 'API key',
    keyHint: 'Starts with sk-. For a company gateway, enter its address below. For Azure OpenAI, choose the provider "Azure OpenAI".',
    defaultModel: OPENAI_MODEL,
    freeModel: true,
    models: [
      { id: 'gpt-5-mini', label: 'GPT-5 mini' },
      { id: 'gpt-5', label: 'GPT-5' },
    ],
  },
  azure: {
    api: 'openai',
    azure: true,
    userBaseUrl: true,
    freeModel: true,
    label: 'Azure OpenAI',
    short: 'Azure OpenAI',
    keyLabel: 'Azure OpenAI key',
    keyHint: 'KEY 1 or KEY 2 from "Keys and Endpoint" of your Azure OpenAI resource. It is sent in the api-key header, only to that resource.',
    // The model is the name of a deployment the organisation created in Azure, so there is no sensible default.
    defaultModel: '',
    models: [],
  },
  gemini: {
    api: 'openai',
    freeModel: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    label: 'Google Gemini',
    short: 'Google Gemini',
    keyLabel: 'Gemini API key',
    keyHint: 'Starts with AIza. Create one in Google AI Studio.',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash - fast and capable' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite - cheapest' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro - best quality' },
    ],
  },
  mistral: {
    api: 'openai',
    freeModel: true,
    baseUrl: 'https://api.mistral.ai/v1',
    label: 'Mistral',
    short: 'Mistral',
    keyLabel: 'Mistral API key',
    keyHint: 'Create one in the Mistral console.',
    defaultModel: 'mistral-large-latest',
    models: [{ id: 'mistral-large-latest', label: 'Mistral Large' }],
  },
  groq: {
    api: 'openai',
    freeModel: true,
    baseUrl: 'https://api.groq.com/openai/v1',
    label: 'Groq',
    short: 'Groq',
    keyLabel: 'Groq API key',
    keyHint: 'Starts with gsk_. Create one in the Groq console.',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B - very fast' }],
  },
  deepseek: {
    api: 'openai',
    freeModel: true,
    baseUrl: 'https://api.deepseek.com/v1',
    label: 'DeepSeek',
    short: 'DeepSeek',
    keyLabel: 'DeepSeek API key',
    keyHint: 'Starts with sk-. Create one on the DeepSeek platform (platform.deepseek.com).',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat - fast and cheap' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner - slower, thinks first' },
    ],
  },
  openrouter: {
    api: 'openai',
    freeModel: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    label: 'OpenRouter',
    short: 'OpenRouter',
    keyLabel: 'OpenRouter API key',
    keyHint: 'Starts with sk-or-. One key for many vendors.',
    // OpenRouter writes a minor version with a dot (anthropic/claude-sonnet-4.5), unlike Anthropic's own ids.
    defaultModel: 'anthropic/claude-sonnet-5.5',
    models: [
      { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5 via OpenRouter' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash via OpenRouter' },
    ],
  },
  ollama: {
    api: 'openai',
    freeModel: true,
    keyOptional: true,
    local: true,
    baseUrl: 'http://localhost:11434/v1',
    label: 'Ollama (on this computer, nothing leaves it)',
    short: 'Ollama',
    keyLabel: 'Key (not needed for Ollama)',
    keyHint: 'Leave empty. Start Ollama first and pull a model, for example: ollama pull llama3.1.',
    defaultModel: 'llama3.1',
    models: [{ id: 'llama3.1', label: 'Llama 3.1' }],
  },
  custom: {
    api: 'openai',
    userBaseUrl: true,
    freeModel: true,
    label: 'Other (OpenAI-compatible server)',
    keyLabel: 'API key',
    keyHint: 'The key your provider gave you. Leave empty for a server on this computer that needs none.',
    defaultModel: '',
    models: [],
  },
};

/** The protocol a provider speaks. */
export const apiOf = (provider) => PROVIDERS[provider]?.api || 'anthropic';

export const DEFAULT_PROVIDER = 'anthropic';

/** The address calls go to: a preset's fixed one, or what the person typed for a provider that allows it ('' = the vendor's own API). */
export const effectiveBaseUrl = (provider, typed = '') => validateBaseUrl(PROVIDERS[provider]?.baseUrl || (PROVIDERS[provider]?.userBaseUrl ? typed : ''));

/**
 * The name used in messages about this provider: "DeepSeek", "Azure OpenAI", "OpenAI"; a gateway or a server of the person's own
 * is named by its host ("The endpoint ai.corp.example"). A custom Anthropic-compatible address is named by its host too.
 */
export function providerName(config = {}) {
  const def = PROVIDERS[config.provider] || {};
  if (def.short && (def.baseUrl || def.azure || !config.baseUrl)) return def.short;
  if (config.baseUrl) {
    try {
      return `The endpoint ${new URL(config.baseUrl).host}`;
    } catch {
      return 'The AI endpoint';
    }
  }
  return def.short || 'The AI endpoint';
}

// Why an Azure set-up cannot be used yet ('' when it can). Reported through `invalidBaseUrl`, which every send checks
// (connectionProblem in src/lib/pipeline.js, and the Settings test).
function azureProblem({ baseUrl, model, options }) {
  if (!baseUrl) return 'Azure OpenAI needs the address of your resource (https://<name>.openai.azure.com). Enter it in Settings.';
  if (!options.apiVersionOk) return 'The Azure API version must look like 2024-10-21 (or 2025-04-01-preview).';
  if (model && !isAzureDeployment(model)) return 'The Azure deployment name may only use letters, digits, - _ and . (up to 64 characters).';
  return '';
}

/**
 * The active { provider, model, apiKey, baseUrl, keyOptional, local, azure? } from the effective settings (see
 * src/policy/policy.js) and a key from the key store. The key is passed in because it lives in the key store, not in settings.
 * With a custom base URL, or a provider with a free model id, the model is whatever was typed; otherwise it must be listed.
 * For Azure the model is the deployment name and `azure` is { form: 'v1' | 'deployment', apiVersion }.
 */
export function resolveProviderConfig(settings = {}, apiKey = '') {
  const provider = PROVIDERS[settings.provider] ? settings.provider : DEFAULT_PROVIDER;
  const def = PROVIDERS[provider];
  const base = effectiveBaseUrl(provider, settings.baseUrls?.[provider]);
  const baseUrl = base.ok ? base.url : '';
  const chosen = typeof settings.models?.[provider] === 'string' ? settings.models[provider].trim() : '';
  const known = def.models.some((m) => m.id === chosen);
  const model = chosen && (known || def.freeModel || baseUrl) ? chosen : def.defaultModel;
  const config = {
    provider,
    model,
    apiKey,
    baseUrl,
    keyOptional: Boolean(def.keyOptional || (baseUrl && base.local && def.api === 'openai')),
    // True for a server on this computer: the only kind a "local-only" PII mode accepts.
    local: Boolean(def.local || base.local),
    // Each request is a one-off (a different record every time), so caching the prefix would only add write cost.
    promptCache: false,
    invalidBaseUrl: base.ok ? '' : base.error,
  };
  if (def.azure) {
    const options = azureOptions(settings.azure);
    config.azure = { form: options.form, apiVersion: options.apiVersion };
    config.invalidBaseUrl = config.invalidBaseUrl || azureProblem({ baseUrl, model, options });
  }
  return config;
}
