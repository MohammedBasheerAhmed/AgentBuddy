// "Waiting on Dana Lee for 3 days": who a request is waiting on for its approval, and for how long (wave 6, the catalog fulfiller). A fulfiller
// who is asked "where is my request?" needs the name to chase and how long it has been; the status line said who, with the date of the
// approval's last update, which moves whenever anyone touches the row. This works from the approval rows the pack already reads (src/context/
// related.js: the approver or group, the state, and the stored time the approval was asked for). Pure: no I/O; the clock comes in as `now`.
//
//   several approvers   the one waited on longest is named, and the others are counted ("2 other approvals are also waiting")
//   a group approval    the group is named (an approver, when the row has both, is the person to chase)
//   an unreadable time  who, not how long. A time that cannot be read is never replaced by the last update: that is another thing
//   nobody readable     "an approver you cannot see": still how long, when the time can be read
//
// No reminder button and nothing is sent: it is one line in the Request card. It says nothing unless an approval is waiting (a rejected
// one comes first in requestStatus, which the caller checks).

import { parseSnTime } from '../context/util.js';
import { spanWords } from '../insights/time.js';
import { describeApproval } from './requestStatus.js';
import { isolate, t, tn } from '../i18n/index.js';

const SKEW_MS = 5 * 60000; // a creation time this far ahead of the clock is a clock that is wrong, not a wait

/**
 * @param {object} pack  a request, requested item or catalog task pack (feature 'request-status')
 * @param {{ now?: number }} [options]
 * @returns {{ line: string, who: string, named: boolean, ms: number|null, others: number } | null}
 *   null when the approvals were not read or none of them is waiting. `ms` is how long the oldest has waited, or null when its time cannot
 *   be read; `others` how many more are waiting.
 */
export function approvalChase(pack, { now = Date.now() } = {}) {
  const rows = Array.isArray(pack?.related?.approvals) ? pack.related.approvals : null;
  if (!rows) return null;
  const waiting = rows
    .map((row) => ({ ...describeApproval(row), at: parseSnTime(row?.createdUtc) }))
    .filter((a) => a.kind === 'pending');
  if (!waiting.length) return null;

  // The oldest whose time can be read; with none, the first that is named (the rows come newest first).
  const dated = waiting.filter((a) => Number.isFinite(a.at)).sort((a, b) => a.at - b.at);
  const first = dated[0] || waiting.find((a) => a.named) || waiting[0];
  const waited = Number.isFinite(first.at) && now - first.at >= -SKEW_MS ? Math.max(0, now - first.at) : null;
  const others = waiting.length - 1;

  const who = isolate(first.who);
  const span = waited === null ? '' : spanWords(waited);
  const base = span ? t('Waiting on {who} for {span}.', { who, span }) : t('Waiting on {who}.', { who });
  const more = others > 0 ? ` ${tn(others, '{n} other approval is also waiting.', '{n} other approvals are also waiting.')}` : '';
  return { line: `${base}${more}`, who: first.who, named: first.named, ms: span ? waited : null, others };
}
