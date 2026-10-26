// Record-context engine: what a feature may know about a ServiceNow record. Pure and dependency-injected; the one file
// that wires the real client is ./live.js and is deliberately not exported from here.

export { FEATURES, FEATURE_FIELDS, FEATURE_JOURNAL, FEATURE_RELATED, FIELDS_BY_KIND, LIMITS, allowedFields, fieldLimit, withheldFields } from './allowlists.js';
export { STATUS, classifyReadError, confirmEmptyIsReallyEmpty } from './access.js';
export { applyAuthorNames, orderChronological, parseJournalString, readJournal } from './journal.js';
export { KINDS, isSensitiveTable, kindForTable, parseRecordRef, tableForNumber } from './kinds.js';
export { PACK_VERSION, readContextPack, resolveRecordRef, stripHtml } from './pack.js';
export { PERSON_FIELDS, personRefs, resolvePeople, splitName } from './people.js';
export { RELATED_BY_KIND, readRelated, relatedPlan } from './related.js';
export { HISTORY_SOURCES, historySignals, normaliseHistoryRow, readCallerHistory } from './history.js';
export { findOpenDuplicates, findSimilarTickets, scoreArticle, scoreHit, searchKnowledge } from './similar.js';
