// Context specs added after the first eight features. Each area has its own file so several people can work at once:
//   itsm.js, domain.js, knowledge.js, compose.js, reports.js
// A file exports { spec, journal, related, fieldsByKind }; see docs/contracts.md, 'Context specs'.
import itsm from './itsm.js';
import domain from './domain.js';
import knowledge from './knowledge.js';
import compose from './compose.js';
import reports from './reports.js';

const parts = [itsm, domain, knowledge, compose, reports];
const merge = (key) => Object.assign({}, ...parts.map((p) => p[key] || {}));

export const EXTRA = Object.freeze({
  spec: merge('spec'),
  journal: merge('journal'),
  related: merge('related'),
  fieldsByKind: merge('fieldsByKind'),
});
