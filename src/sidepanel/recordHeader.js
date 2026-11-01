// The card at the top of a record: number, title and a few tags. Its read can succeed, be refused, or succeed with nothing in it
// (an ACL that returns a row with empty columns); each one is said in words instead of an endless "Loading…".

import { tm, t as tr } from '../i18n/index.js';

// English constants (the tests compare them); describeHeader shows them in the language of the panel.
export const HEADER_LOADING = tm('Loading…');
export const HEADER_DENIED = tm('Details are not available to you.');
export const HEADER_NO_TITLE = tm('(no short description)');

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** 'ready' when the answer has anything readable in it, else 'failed'. */
export function headerPhase(answer) {
  if (!answer || typeof answer !== 'object') return 'failed';
  return ['number', 'short_description', 'state', 'priority'].some((k) => text(answer[k])) ? 'ready' : 'failed';
}

/**
 * What the card shows.
 * @param {{ phase: 'loading'|'ready'|'failed', header: object|null }} state
 * @param {{ number?: string, table: string }} record what the page told us about the record
 * @returns {{ number: string, title: string, titleKind: 'loading'|'text'|'missing'|'denied', tags: string[] }}
 */
export function describeHeader(state, record) {
  const header = state.header || {};
  const number = record.number || text(header.number) || record.table;
  if (state.phase === 'loading') return { number, title: tr(HEADER_LOADING), titleKind: 'loading', tags: [record.table] };
  if (state.phase === 'failed') return { number, title: tr(HEADER_DENIED), titleKind: 'denied', tags: [record.table] };
  const title = text(header.short_description);
  return {
    number,
    title: title || tr(HEADER_NO_TITLE),
    titleKind: title ? 'text' : 'missing',
    tags: [record.table, text(header.state), text(header.priority)].filter(Boolean),
  };
}
