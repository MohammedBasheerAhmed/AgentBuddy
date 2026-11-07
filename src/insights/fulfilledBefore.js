// "Fulfilled before" (wave 6, the catalog fulfiller): what the card says about the last completed tasks for the same catalog item. The
// read is src/content/ops/fix.js `fulfilledBefore` (the newest five tasks that ended Closed Complete, who did each, when it was opened and
// closed, its close notes); this turns the answer into the words of the card. ServiceNow cannot show it on the task, and the agent who is
// about to do the same work wants to know how it went last time and who to ask. Pure; the clock comes in as `now`.
//
// No AI and nothing sent anywhere: the names and notes are shown to the agent only (the read returns them as `people` so that, should one
// ever reach a prompt, the firewall masks them). Honest as every card is (build rule 9): "none" is said only when the read completed; a
// refusal, a column the person cannot read or a read the instance did not apply is "could not check", never "none"; the organisation
// blocking the table is said once, quietly, and gives no line of its own.

import { STATUS } from '../context/access.js';
import { readDone, readFully } from '../context/seen.js';
import { parseSnTime } from '../context/util.js';
import { firstSentences } from './steps.js';
import { agoText, spanWords } from './time.js';
import { isolate, t } from '../i18n/index.js';

const NOTES_SHOWN = 200; // characters of close notes on a row

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** How long a task took, from its stored opened and closed times, in words ("2 days"); '' when either is missing or they are the wrong way round. */
export function tookText(item) {
  const from = parseSnTime(item?.openedUtc);
  const to = parseSnTime(item?.closedUtc);
  return Number.isFinite(from) && Number.isFinite(to) && to >= from ? spanWords(to - from) : '';
}

const whenText = (item, now) => {
  const closed = parseSnTime(item?.closedUtc);
  return Number.isFinite(closed) ? agoText(Math.max(0, now - closed)) : '';
};

/**
 * One earlier task as a row: its number and title, a line ("Dana Lee · took 2 days · closed 3 d ago": each part only when it is known) and
 * its close notes cut to their first sentences. A task whose notes column could not be read says so; one with none written says that.
 */
export function fulfilledRow(item, now = Date.now()) {
  const took = tookText(item);
  const when = whenText(item, now);
  const who = text(item?.who);
  const line = [who && isolate(who), took && t('took {span}', { span: took }), when && t('closed {when}', { when })].filter(Boolean).join(' · ');
  const notes = firstSentences(item?.notes, NOTES_SHOWN);
  return {
    key: `${item?.table}:${item?.sysId}`,
    table: item?.table,
    sysId: item?.sysId,
    number: text(item?.number),
    short_description: text(item?.short_description),
    line,
    extra: notes || (item?.notesUnread === true ? t('Close notes are not shown to you.') : t('No close notes.')),
  };
}

// The card's one line: how the last one went. Parts that are not known are left out (how long it took needs the closing time too, so a
// task with no closing time has neither).
function lastLine(item, now) {
  const took = tookText(item);
  const when = whenText(item, now);
  if (when && took) return t('Last done {when}, took {span}', { when, span: took });
  if (when) return t('Last done {when}', { when });
  return t('Done before');
}

/**
 * @param {{ items?: object[], access?: object[] }|null} data  the `fulfilledBefore` answer
 * @returns {{ state: 'rows' | 'none' | 'unseen' | 'blocked' | 'skipped' | 'pending', items: object[], summary: string, attention: string, note: string }}
 *   summary: the card's one line; attention: 'ok' (a precedent was found), 'clear' (none, and the read saw everything it looked at), or ''.
 *   note: for 'skipped', the engine's own sentence (a fixed one, shown through plainNote).
 */
export function fulfilledView(data, { now = Date.now() } = {}) {
  if (!data || typeof data !== 'object') return { state: 'pending', items: [], summary: '', attention: '', note: '' };
  const access = Array.isArray(data.access) ? data.access : [];
  const list = (Array.isArray(data.items) ? data.items : []).filter((item) => item && typeof item === 'object' && item.sysId);
  if (list.length) return { state: 'rows', items: list.map((item) => fulfilledRow(item, now)), summary: lastLine(list[0], now), attention: 'ok', note: '' };

  // The organisation's own rule: said once under the card, with no line of its own and no dot.
  if (access.some((a) => a?.status === STATUS.BLOCKED)) return { state: 'blocked', items: [], summary: '', attention: '', note: '' };
  // A read that could not see everything it looked at is not "none".
  if (!readFully(access)) return { state: 'unseen', items: [], summary: t('Could not check earlier tasks for this item'), attention: '', note: '' };
  if (readDone(access)) return { state: 'none', items: [], summary: t('No earlier tasks for this item that you can see'), attention: 'clear', note: '' };
  // Not looked up on purpose (no catalog item to compare, sensitive data): its own sentence, no claim either way.
  const skipped = access.find((a) => a?.status === STATUS.SKIPPED && text(a.note));
  return { state: 'skipped', items: [], summary: '', attention: '', note: skipped ? text(skipped.note) : '' };
}
