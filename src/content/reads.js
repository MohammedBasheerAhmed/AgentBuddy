// READ operations the side panel can ask the content script for. Everything goes through the context engine
// (src/context), which only issues GET requests with the person's own session, so ACLs decide what comes back.
// Arguments arrive from an extension page but are still validated: a table name is a plain identifier, a sys_id is
// 32 hex characters, and a feature must be one the context engine knows.
import { readContextPack, readCallerHistory, findSimilarTickets, findOpenDuplicates, searchKnowledge, FEATURES } from '../context/index.js';
import { createLiveDeps } from '../context/live.js';
import { SYS_ID_RE, TABLE_RE } from '../context/util.js';
import { readMyDay } from '../reports/myDay.js';
import { tryCallPage } from './pageBridge.js';

function checkRecord({ table, sysId }) {
  if (!TABLE_RE.test(table || '') || !SYS_ID_RE.test(sysId || '')) throw new Error('That is not a valid record.');
}

// A pack passed back by the panel is only used for its table, id and the few fields the similarity search reads.
function checkPack(pack) {
  if (!pack || typeof pack !== 'object') throw new Error('A ticket is needed for this search.');
  checkRecord(pack);
  return pack;
}

export async function handleRead(op, args) {
  const deps = createLiveDeps();
  switch (op) {
    case 'pack': {
      checkRecord(args);
      const feature = FEATURES.includes(args.feature) ? args.feature : 'record-summary';
      return readContextPack({ table: args.table, sysId: args.sysId }, deps, { feature, allowSensitive: args.allowSensitive === true });
    }
    case 'history': {
      if (!SYS_ID_RE.test(args.callerSysId || '')) throw new Error('This ticket has no caller to look up.');
      return readCallerHistory({ callerSysId: args.callerSysId, excludeSysId: SYS_ID_RE.test(args.excludeSysId || '') ? args.excludeSysId : '' }, deps, { limit: 10, allowSensitive: args.allowSensitive === true });
    }
    case 'myday': {
      // The signed-in user's own id comes from the page, never from the panel.
      const session = await tryCallPage('getSessionInfo');
      return readMyDay({ userId: session?.userId || '' }, deps, {});
    }
    case 'similar':
      return findSimilarTickets(checkPack(args.pack), deps, { resolvedOnly: args.resolvedOnly === true, allowSensitive: args.allowSensitive === true });
    case 'duplicates':
      return findOpenDuplicates(checkPack(args.pack), deps, { windowHours: Number(args.windowHours) || 24, allowSensitive: args.allowSensitive === true });
    case 'knowledge':
      return searchKnowledge(checkPack(args.pack), deps, { limit: 5 });
    default:
      throw new Error('Unknown request.');
  }
}
