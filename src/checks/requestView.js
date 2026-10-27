// What the "Request" tab shows, built from a ContextPack, and the extra parts the plain-words status message is written
// from. Pure: no I/O, no React. The view only draws what this returns.
//
// Rows hold text exactly as it is on the pack. Answers of masked or secret questions never get this far: the context
// engine (src/context/related.js) leaves them out and counts them in the access note, which becomes a "hidden" row here.

import { packToParts } from '../features/parts.js';
import { finishedKind, isOpenItem, ownerOf } from './states.js';
import { describeApproval, requestStatus, taskLine } from './requestStatus.js';

const text = (v) => String(v ?? '').trim();
const HIDDEN = 'hidden';

const FACT_LABELS = [
  ['state', 'State'],
  ['request_state', 'Request state'],
  ['stage', 'Stage'],
  ['approval', 'Approval'],
  ['requested_for', 'Requested for'],
  ['cat_item', 'Catalog item'],
  ['opened_at', 'Opened'],
];

const accessEntryFor = (pack, source) => (pack?.access || []).find((e) => e?.source === source) || null;

/** The answers table: { available, rows: [{ question, value, hidden }], note }. */
export function answersModel(pack) {
  // Only a requested item carries the answers (a request holds its items; a task points at its item).
  if (pack?.kind !== 'requested_item') return { applicable: false, available: false, rows: [], note: '' };
  const entry = accessEntryFor(pack, 'sc_item_option_mtom');
  const list = pack?.related?.variables;
  if (!Array.isArray(list)) {
    const why = entry?.status === 'denied' ? 'You cannot read the answers to the request questions.' : entry?.note || 'The answers could not be read.';
    return { applicable: true, available: false, rows: [], note: why };
  }
  const rows = list.map((v) => {
    const value = text(v?.value);
    const hidden = v?.hidden === true || !value;
    return { question: text(v?.question) || 'Question', value: hidden ? HIDDEN : value, hidden };
  });
  // related.js says how many masked or secret answers it left out; show them as one honest "hidden" row.
  const note = text(entry?.note);
  const masked = /(\d+)\s+masked or secret answers?/i.exec(note);
  if (masked && Number(masked[1]) > 0) rows.push({ question: 'Masked or secret answers', value: `${HIDDEN} (${masked[1]})`, hidden: true });
  const rest = note.replace(/\d+\s+masked or secret answers?\s+(?:was|were)\s+left out\.?/i, '').trim();
  return { applicable: true, available: true, rows, note: rest };
}

/** The approvals table: { available, rows: [{ who, state, kind, tone, when }] }. */
export function approvalsModel(pack) {
  const list = pack?.related?.approvals;
  if (!Array.isArray(list)) return { applicable: pack?.kind !== 'catalog_task', available: false, rows: [] };
  const tone = { approved: 'ok', rejected: 'danger', pending: 'warn' };
  return {
    applicable: true,
    available: true,
    rows: list.map(describeApproval).map((a) => ({ who: a.who, state: a.state || 'No state', kind: a.kind, tone: tone[a.kind] || '', when: a.updated })),
  };
}

/** The chain: catalog tasks of a requested item, or the requested items of a request. */
export function chainModel(pack, { currentNumber = '' } = {}) {
  const key = pack?.kind === 'request' ? 'items' : pack?.kind === 'requested_item' ? 'catalogTasks' : '';
  if (!key) return { applicable: false, available: false, title: '', rows: [] };
  const title = key === 'items' ? 'Requested items' : 'Catalog tasks';
  const list = pack?.related?.[key];
  if (!Array.isArray(list)) return { applicable: true, available: false, title, rows: [] };
  return {
    applicable: true,
    available: true,
    title,
    rows: list.map((t) => ({
      number: text(t.number),
      label: text(t.short_description) || text(t.item),
      state: text(t.state) || 'No state',
      owner: ownerOf(t),
      due: text(t.due),
      open: isOpenItem(t),
      done: finishedKind(t.state) === 'done',
      current: Boolean(currentNumber) && text(t.number) === currentNumber,
    })),
  };
}

/**
 * The whole tab: the status line first, then the facts, answers, approvals and the chain.
 * @param {object} pack ContextPack of the request, the requested item or (when its item cannot be read) the task
 * @param {{ currentNumber?: string, now?: number }} [options] currentNumber marks the row of the record the agent has open
 */
export function buildRequestView(pack, { currentNumber = '', now = Date.now() } = {}) {
  const facts = FACT_LABELS.map(([key, label]) => [label, text(pack?.fields?.[key])]).filter(([, value]) => value);
  return {
    number: text(pack?.fields?.number) || text(pack?.number),
    title: text(pack?.fields?.short_description),
    status: requestStatus(pack, { now }),
    facts,
    answers: answersModel(pack),
    approvals: approvalsModel(pack),
    chain: chainModel(pack, { currentNumber }),
  };
}

// ---- The plain-words status message ------------------------------------------------------------------------------

/**
 * Parts for the AI feature 'request-explain': the pack's ordinary fields and its latest customer-visible comments, plus the
 * status the tool worked out, the approvals and the tasks. No answers to the request questions are sent (the message does
 * not need them). All of it is untrusted ticket text that the firewall masks.
 */
export function requestExplainParts(pack) {
  const parts = packToParts(pack, { journal: 6, journalTypes: ['comment'] });
  const status = requestStatus(pack);
  const lines = [status.line, status.due ? `Due: ${status.due.text}` : '', status.sla ? status.sla.text : ''].filter(Boolean);
  parts.push({ label: 'Status worked out from the records', field: 'status', text: lines.join('\n') });

  const approvals = approvalsModel(pack);
  if (approvals.rows.length) {
    parts.push({ label: 'Approvals', field: 'approvals', text: approvals.rows.map((a) => `${a.who}: ${a.state}${a.when ? ` (${a.when})` : ''}`).join('\n') });
  }
  const chain = chainModel(pack);
  if (chain.rows.length) {
    parts.push({
      label: chain.title,
      field: chain.title === 'Requested items' ? 'items' : 'tasks',
      text: chain.rows.map((r) => `${taskLine({ number: r.number, short_description: r.label })}: ${r.state}${r.owner ? `, with ${r.owner}` : ', not assigned'}${r.due ? `, due ${r.due}` : ''}`).join('\n'),
    });
  }
  return parts;
}
