// Context specs added after the first eight features. Each area has its own file so several people can work at once:
//   itsm.js, domain.js, knowledge.js, compose.js, reports.js, checks.js
// A file exports { spec, journal, related, fieldsByKind, extendFields }; see docs/contracts.md, 'Context specs'.
import itsm from './itsm.js';
import domain from './domain.js';
import knowledge from './knowledge.js';
import compose from './compose.js';
import reports from './reports.js';
import checks from './checks.js';

const parts = [itsm, domain, knowledge, compose, reports, checks];
const merge = (key) => Object.assign({}, ...parts.map((p) => p[key] || {}));

// extendFields adds columns to the display ceiling of a kind that already exists (never removes or replaces any):
//   extendFields: { incident: ['reopen_count'] }
function mergeExtend() {
  const out = {};
  for (const p of parts) for (const [kind, names] of Object.entries(p.extendFields || {})) out[kind] = [...new Set([...(out[kind] || []), ...names])];
  return out;
}

export const EXTRA = Object.freeze({
  spec: merge('spec'),
  journal: merge('journal'),
  related: merge('related'),
  fieldsByKind: merge('fieldsByKind'),
  extendFields: mergeExtend(),
});
