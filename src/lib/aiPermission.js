// The browser permission for the AI address. Agent Buddy asks for it per provider, when the person first uses it (or tests
// the connection), never for "all sites". Call ensureAiPermission() straight from a click so the browser can show its prompt.
import { originPattern } from './aiUsage.js';

/** The match pattern for the address calls will go to, or '' if none is needed. */
export function aiOriginPattern(config) {
  if (config.baseUrl) return originPattern(config.baseUrl);
  if (config.provider === 'anthropic') return 'https://api.anthropic.com/*';
  if (config.provider === 'openai') return 'https://api.openai.com/*';
  return '';
}

/** Resolves when the browser has granted access to the AI address; throws a plain message if the person said no. */
export async function ensureAiPermission(config) {
  const pattern = aiOriginPattern(config);
  if (!pattern) return;
  if (await chrome.permissions.contains({ origins: [pattern] })) return;
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) throw new Error(`Agent Buddy needs your permission to contact ${pattern.replace(/^https?:\/\//, '').replace('/*', '')}. Nothing was sent.`);
}
