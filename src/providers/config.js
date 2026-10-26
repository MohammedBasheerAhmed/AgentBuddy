// Single source of truth for providers and models. Do not hardcode a model name anywhere else in the codebase.
import { validateBaseUrl } from '../lib/aiUsage.js';

export const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_MODEL = 'gpt-5-mini';
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

// Every provider speaks one of two protocols: 'anthropic' (the Messages API) or 'openai' (Chat Completions, which most other
// vendors, gateways and local servers offer too). A preset has a fixed `baseUrl`; `userBaseUrl` means the person (or the
// organisation's policy) may supply one; `freeModel` means the model id is free text, so a new model never needs a release.
// Summaries and drafts do not need the largest model, so the defaults lean to the fast tier.
export const PROVIDERS = {
  anthropic: {
    api: 'anthropic',
    userBaseUrl: true,
    label: 'Anthropic (Claude)',
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
    label: 'OpenAI / Azure OpenAI / company gateway',
    keyLabel: 'API key',
    keyHint: 'Starts with sk-. For Azure OpenAI or an internal gateway, enter its address below.',
    defaultModel: OPENAI_MODEL,
    freeModel: true,
    models: [
      { id: 'gpt-5-mini', label: 'GPT-5 mini' },
      { id: 'gpt-5', label: 'GPT-5' },
    ],
  },
  gemini: {
    api: 'openai',
    freeModel: true,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    label: 'Google Gemini',
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
    keyLabel: 'Groq API key',
    keyHint: 'Starts with gsk_. Create one in the Groq console.',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B - very fast' }],
  },
  openrouter: {
    api: 'openai',
    freeModel: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    label: 'OpenRouter',
    keyLabel: 'OpenRouter API key',
    keyHint: 'Starts with sk-or-. One key for many vendors.',
    defaultModel: 'anthropic/claude-sonnet-5-5',
    models: [
      { id: 'anthropic/claude-sonnet-5-5', label: 'Claude Sonnet 5.5 via OpenRouter' },
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
 * The active { provider, model, apiKey, baseUrl, keyOptional, local } from the effective settings (see
 * src/policy/policy.js) and a key from the key store. The key is passed in because it lives in the key store, not in settings.
 * With a custom base URL, or a provider with a free model id, the model is whatever was typed; otherwise it must be listed.
 */
export function resolveProviderConfig(settings = {}, apiKey = '') {
  const provider = PROVIDERS[settings.provider] ? settings.provider : DEFAULT_PROVIDER;
  const def = PROVIDERS[provider];
  const base = effectiveBaseUrl(provider, settings.baseUrls?.[provider]);
  const baseUrl = base.ok ? base.url : '';
  const chosen = typeof settings.models?.[provider] === 'string' ? settings.models[provider].trim() : '';
  const known = def.models.some((m) => m.id === chosen);
  const model = chosen && (known || def.freeModel || baseUrl) ? chosen : def.defaultModel;
  return {
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
}
