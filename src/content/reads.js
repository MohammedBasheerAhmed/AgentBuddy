// READ operations the side panel can ask the content script for. Everything goes through the context engine
// (src/context), which only issues GET requests with the person's own session, so ACLs decide what comes back.
// Arguments arrive from an extension page but are still validated: a table name is a plain identifier, a sys_id is
// 32 hex characters, and a feature must be one the context engine knows.
//
// The organisation's policy applies here, at the boundary: the deps every read uses are wrapped by src/content/policyGuard.js, so
// a table in `blockedTables` is not read at all, and `allowSensitive` (HR content) cannot be raised above what the managed policy allows.
import { readContextPack, readCallerHistory, findSimilarTickets, findOpenDuplicates, searchKnowledge, FEATURES } from '../context/index.js';
import { createLiveDeps } from '../context/live.js';
import { SYS_ID_RE } from '../context/util.js';
import { OPS } from './ops/index.js';
import { checkRecord, checkPack } from './ops/validate.js';
import { policyGuard } from './policyGuard.js';

/**
 * The feature a 'pack' read is for. An unknown or missing one is refused: falling back to a default would read the widest list
 * of columns (every person, notes, close notes) for a typo or a forged message.
 */
export function checkPackFeature(feature) {
  if (typeof feature !== 'string' || !FEATURES.includes(feature)) throw new Error('That is not a feature Agent Buddy can read for.');
  return feature;
}

export async function handleRead(op, args, { guard = policyGuard, makeDeps = createLiveDeps, policy = null, currentRecord = null } = {}) {
  // `policy`: the panel's normalised policy, sent with the message; merged with the managed policy the guard reads itself.
  // `currentRecord`: the record the content script finds on the page now (src/content/index.js resolveRecord). An operation that
  // reads the page itself (resolutionFacts on a Workspace) checks it is the record it was asked about; it never comes from the panel.
  const deps = await guard.deps(makeDeps(), policy);
  const allowSensitive = await guard.allowSensitive(args?.allowSensitive === true, policy);
  switch (op) {
    case 'pack': {
      checkRecord(args);
      const feature = checkPackFeature(args.feature);
      return readContextPack({ table: args.table, sysId: args.sysId }, deps, { feature, allowSensitive });
    }
    case 'history': {
      if (!SYS_ID_RE.test(args.callerSysId || '')) throw new Error('This ticket has no caller to look up.');
      return readCallerHistory({ callerSysId: args.callerSysId, excludeSysId: SYS_ID_RE.test(args.excludeSysId || '') ? args.excludeSysId : '' }, deps, { limit: 10, allowSensitive });
    }
    case 'similar':
      return findSimilarTickets(checkPack(args.pack), deps, { resolvedOnly: args.resolvedOnly === true, allowSensitive });
    case 'duplicates':
      return findOpenDuplicates(checkPack(args.pack), deps, { windowHours: Number(args.windowHours) || 24, allowSensitive });
    case 'knowledge':
      return searchKnowledge(checkPack(args.pack), deps, { limit: 5 });
    default: {
      // Operations added by area modules (src/content/ops). Own-property check: no prototype lookups.
      if (Object.prototype.hasOwnProperty.call(OPS, op)) return OPS[op](args || {}, { deps, checkRecord, checkPack, allowSensitive, currentRecord });
      throw new Error('Unknown request.');
    }
  }
}
