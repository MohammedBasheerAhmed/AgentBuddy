// Context specs added after the first eight features. Each area has its own file so several people can work at once:
//   itsm.js, domain.js, knowledge.js, compose.js, reports.js, checks.js, insights.js, mywork.js, caller.js
// A file exports { spec, journal, related, fieldsByKind, extendFields, limits }; see docs/contracts.md, 'Context specs'.
import itsm from './itsm.js';
import domain from './domain.js';
import knowledge from './knowledge.js';
import compose from './compose.js';
import reports from './reports.js';
import checks from './checks.js';
import insights from './insights.js';
import mywork from './mywork.js';
import caller from './caller.js';
import understand from './understand.js';
import fix from './fix.js';
import close from './close.js';
import fit from './fit.js';

const parts = [itsm, domain, knowledge, compose, reports, checks, insights, mywork, caller, understand, fix, close, fit];
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
  limits: merge('limits'), // { columnName: maxCharacters } for a text column longer than the default
  // { feature: [date columns] }: the pack also carries their STORED (UTC) values in related.times, for a feature that compares
  // them with note times (stored UTC) or with the clock. Field values are display values in the reader's time zone.
  times: merge('times'),
});
