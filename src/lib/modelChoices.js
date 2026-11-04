// The models a person can pick from for the provider in use: the one in use first, then the ones loaded from the server, then the
// provider's own short list. When the organisation's policy lists the allowed models, only those are offered, and every one of them
// is offered (a model the policy names may not be on the provider's short list, and runs honour it: src/providers/config.js).

/**
 * @param {{ def: { models?: { id: string, label?: string }[] }, current?: string, loaded?: string[], allowed?: string[] | null }} input
 * @returns {{ id: string, label: string }[]}
 */
export function modelChoices({ def, current = '', loaded = [], allowed = null }) {
  const labels = new Map((def?.models || []).map((m) => [m.id, m.label || m.id]));
  const permitted = Array.isArray(allowed) && allowed.length ? new Set(allowed) : null;
  const ids = [current, ...(Array.isArray(loaded) ? loaded : []), ...labels.keys(), ...(permitted || [])].filter((id) => typeof id === 'string' && id);
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (seen.has(id) || (permitted && !permitted.has(id))) continue;
    seen.add(id);
    out.push({ id, label: labels.get(id) || id });
  }
  return out;
}
