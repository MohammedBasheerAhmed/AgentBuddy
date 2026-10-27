// The use-case registry. Each feature is data: what it is called, which records it works on, which fields it may send
// (the data-minimisation allowlist), the instructions given to the model, and where the result can be inserted.
//
// Features live in packs (src/features/packs/*.js), one array per area, so several people can add features without
// touching the same file. This file only joins them and answers questions about them. See docs/contracts.md,
// "Feature definition", for every field a feature may carry.
//
// Prompt rules shared by every feature live in the firewall preamble (untrusted ticket data, no links or images, keep
// [PLACEHOLDERS] exactly). The text here is the task only. Nothing in a prompt contains ticket data: that arrives as parts.

import { packToParts } from './parts.js';
import core from './packs/core.js';
import itsm from './packs/itsm.js';
import domain from './packs/domain.js';
import knowledge from './packs/knowledge.js';
import compose from './packs/compose.js';
import reports from './packs/reports.js';
import checks from './packs/checks.js';

export const FEATURES = [...core, ...itsm, ...domain, ...knowledge, ...compose, ...reports, ...checks];

export const featureById = (id) => FEATURES.find((f) => f.id === id) || null;

/** A feature marked `defaultOff` (for example the coaching snapshot) stays off until the organisation's policy turns it on. */
export function isFeatureAvailable(feature, policy) {
  if (!feature) return false;
  if ((policy?.disabledFeatures || []).includes(feature.id)) return false;
  if (feature.defaultOff && policy?.coachingEnabled !== true) return false;
  return true;
}

/** Features that show in the Actions list for this kind of record, minus the ones policy has switched off. */
export function featuresFor(kind, policy) {
  return FEATURES.filter((f) => (f.kinds || []).includes(kind) && isFeatureAvailable(f, policy));
}

/** The context spec (src/context/allowlists.js) a feature reads its pack with: its own id unless it names another. */
export const contextFor = (feature) => feature.context || feature.id;

/** The inserts a feature offers: `insert` may be absent (copy only), one object, or a list. */
export const insertsFor = (feature) => [].concat(feature?.insert || []).filter(Boolean);

/** The parts the firewall will wrap for this feature. */
export const partsFor = (feature, pack) => (feature.parts ? feature.parts(pack) : packToParts(pack, { journal: feature.journal }));
