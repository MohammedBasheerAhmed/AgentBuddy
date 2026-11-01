// What the "Request" tab shows, built from a ContextPack, and the extra parts the plain-words status message is written
// from. Pure: no I/O, no React. The view only draws what this returns.
//
// Rows hold text exactly as it is on the pack. Answers of masked or secret questions never get this far: the context
// engine (src/context/related.js) leaves them out and counts them in the access note, which becomes a "hidden" row here.

import { packToParts } from '../features/parts.js';
import { finishedKind, isOpenItem, ownerOf } from './states.js';
import { describeApproval, requestStatus, taskLine } from './requestStatus.js';
import { inEnglish } from './inEnglish.js';
import { t } from '../i18n/index.js';

const text = (v) => String(v ?? '').trim();
const factLabels = () => [
  ['state', t('State')],
  ['request_state', t('Request state')],
  ['stage', t('Stage')],
  ['approval', t('Approval')],
  ['requested_for', t('Requested for')],
  ['cat_item', t('Catalog item')],
  ['opened_at', t('Opened')],
];

const accessEntryFor = (pack, source) => (pack?.access || []).find((e) => e?.source === source) || null;

/** The answers table: { available, rows: [{ question, value, hidden }], note }. */
export function answersModel(pack) {
  // Only a requested item carries the answers (a request holds its items; a task points at its item).
  if (pack?.kind !== 'requested_item') return { applicable: false, available: false, rows: [], note: '' };
  const entry = accessEntryFor(pack, 'sc_item_option_mtom');
  const list = pack?.related?.variables;
  if (!Array.isArray(list)) {
    const why =
      entry?.status === 'blocked'
        ? t('Your organisation does not allow Agent Buddy to read the answers to the request questions.')
        : entry?.status === 'denied'
          ? t('You cannot read the answers to the request questions.')
          : entry?.note || t('The answers could not be read.');
    return { applicable: true, available: false, rows: [], note: why };
  }
  const rows = list.map((v) => {
    const value = text(v?.value);
    const hidden = v?.hidden === true || !value;
    return { question: text(v?.question) || t('Question'), value: hidden ? t('hidden') : value, hidden };
  });
  // related.js says how many masked or secret answers it left out; show them as one honest "hidden" row.
  const note = text(entry?.note);
  const masked = /(\d+)\s+masked or secret answers?/i.exec(note);
  if (masked && Number(masked[1]) > 0) rows.push({ question: t('Masked or secret answers'), value: t('hidden ({count})', { count: masked[1] }), hidden: true });
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
    rows: list.map(describeApproval).map((a) => ({ who: a.who, state: a.state || t('No state'), kind: a.kind, tone: tone[a.kind] || '', when: a.updated })),
  };
}

/** The chain: catalog tasks of a requested item, or the requested items of a request. */
export function chainModel(pack, { currentNumber = '' } = {}) {
  const key = pack?.kind === 'request' ? 'items' : pack?.kind === 'requested_item' ? 'catalogTasks' : '';
  if (!key) return { applicable: false, available: false, title: '', rows: [] };
  const title = key === 'items' ? t('Requested items') : t('Catalog tasks');
  const list = pack?.related?.[key];
  if (!Array.isArray(list)) return { applicable: true, available: false, title, rows: [] };
  return {
    applicable: true,
    available: true,
    title,
    rows: list.map((row) => ({
      number: text(row.number),
      label: text(row.short_description) || text(row.item),
      state: text(row.state) || t('No state'),
      owner: ownerOf(row),
      due: text(row.due),
      open: isOpenItem(row),
      done: finishedKind(row.state) === 'done',
      current: Boolean(currentNumber) && text(row.number) === currentNumber,
    })),
  };
}

/**
 * The whole tab: the status line first, then the facts, answers, approvals and the chain.
 * @param {object} pack ContextPack of the request, the requested item or (when its item cannot be read) the task
 * @param {{ currentNumber?: string, now?: number }} [options] currentNumber marks the row of the record the agent has open
 */
export function buildRequestView(pack, { currentNumber = '', now = Date.now() } = {}) {
  const facts = factLabels().map(([key, label]) => [label, text(pack?.fields?.[key])]).filter(([, value]) => value);
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
export const requestExplainParts = (pack) => inEnglish(() => explainParts(pack)); // the AI's copy is English whatever the panel's language

function explainParts(pack) {
  // The assignee and the person who opened it are known to the firewall (the pack holds them) but are not sent as fields.
  const parts = packToParts(pack, { journal: 6, journalTypes: ['comment'], skipFields: ['assigned_to', 'opened_by'] });
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

/**
 * Where "Insert as customer comment" puts the message, when that is not where the requester looks. The message is for the
 * requester, who normally reads the requested item; on a catalog task the comment lands on the task itself.
 */
export const destinationNote = (record) => (record?.kind === 'catalog_task' ? t("This goes into the task's comments.") : '');
