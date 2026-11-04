// The browser permission for the AI address. Agent Buddy asks for it per provider, when the person first uses it (or tests
// the connection), never for "all sites". Call ensureAiPermission() straight from a click so the browser can show its prompt.
// Azure OpenAI and company gateways ask for the host of the address that was entered (one resource, one gateway), never a wildcard.
import { originPattern } from './aiUsage.js';
import { t, isolate } from '../i18n/index.js';

/** The match pattern for the address calls will go to, or '' if none is needed (or the address is not usable, so nothing is sent). */
export function aiOriginPattern(config) {
  if (config.invalidBaseUrl) return '';
  if (config.baseUrl) return originPattern(config.baseUrl);
  if (config.provider === 'anthropic') return 'https://api.anthropic.com/*';
  if (config.provider === 'openai') return 'https://api.openai.com/*';
  return '';
}

/** "corp.openai.azure.com" from "https://corp.openai.azure.com/*", for messages. */
const hostOfPattern = (pattern) => pattern.replace(/^https?:\/\//, '').replace('/*', '');

/** Resolves when the browser has granted access to the AI address; throws a plain message if the person said no. */
export async function ensureAiPermission(config, permissions = globalThis.chrome?.permissions) {
  const pattern = aiOriginPattern(config);
  if (!pattern) return;
  // An enterprise build was given its AI address at install (host_permissions): `contains` is true there and nothing is asked.
  if (await permissions.contains({ origins: [pattern] })) return;
  let granted;
  try {
    granted = await permissions.request({ origins: [pattern] });
  } catch {
    // The browser refuses to even ask for a host the build does not list (an enterprise build with fixed hosts).
    throw new Error(t('This build of Agent Buddy cannot contact {host}. Your organisation decides which AI address it may use. Nothing was sent.', { host: isolate(hostOfPattern(pattern)) }));
  }
  if (!granted) throw new Error(t('Agent Buddy needs your permission to contact {host}. Nothing was sent.', { host: isolate(hostOfPattern(pattern)) }));
}
