// What the bar on the ServiceNow page asks, and when, with no DOM (tests/bar-sync.test.js). bar.js draws; this decides.
//
// The order matters for what Agent Buddy does while the side panel is closed:
//   1. The service worker is asked first whether the bar is on here at all (no table, nothing about the page). While the person or
//      the organisation has switched the bar off, that question every PROBE_MS is ALL that happens: the page is not looked at, the
//      page bridge is not called and no record number is looked up.
//   2. Only with the bar on is the page looked at for the record that is open (resolveRecord), and the worker asked which actions
//      that kind of record gets (again every REASK_MS, so a change in Settings shows within seconds).
//   3. The answer SITE_OFF (the site was turned off, its permission removed, or the organisation's list changed) ends everything:
//      onSiteOff() is called once and every later tick does nothing.
import { MSG, SITE_OFF_CODE } from '../lib/messages.js';
import { PROBE_MS, cleanActions, isGone, needsAsk } from './barLogic.js';

const NOTHING = Object.freeze({ status: 'hidden', record: null, actions: [] });

/**
 * @param {{ send: (message: object) => Promise<any>, resolveRecord: () => Promise<{table: string, sysId: string}|null>,
 *           now?: () => number, onSiteOff?: () => void }} deps
 * @returns {{ tick: () => Promise<{ status: 'shown'|'hidden'|'off'|'gone', record: object|null, actions: object[] }> }}
 *   status: 'shown' a record with actions; 'hidden' nothing to show; 'off' the site was turned off; 'gone' the extension was reloaded
 */
export function createBarSync({ send, resolveRecord, now = Date.now, onSiteOff = () => {} }) {
  let ended = ''; // 'off' | 'gone' once it is over
  let barOn = null; // what the worker said last: is the bar on here?
  let checkedAt = NaN; // when the worker last answered about this site
  let table = '';
  let askedAt = NaN;
  let actions = [];
  let language = ''; // what the worker said the bar should speak
  let theme = ''; // and which colours: 'light', 'dark' or '' (the computer's)

  // One question to the worker. null when the answer ended the bar (the site is off).
  async function ask(message, at) {
    const answer = await send(message);
    if (answer?.error?.code === SITE_OFF_CODE) {
      ended = 'off';
      onSiteOff();
      return null;
    }
    checkedAt = at;
    if (typeof answer?.language === 'string') language = answer.language;
    if (typeof answer?.theme === 'string') theme = answer.theme;
    return answer || {};
  }

  async function probe(at) {
    const answer = await ask({ type: MSG.BAR_ACTIONS }, at);
    if (!answer) return false;
    barOn = !answer.error && answer.bar === true;
    return true;
  }

  async function step() {
    const at = now();
    // 1. Is the bar on here at all? Asked again only every PROBE_MS while it is off (or not known after an error).
    if (barOn !== true) {
      if (Number.isFinite(checkedAt) && at - checkedAt < PROBE_MS) return NOTHING;
      if (!(await probe(at)) || barOn !== true) return ended ? { ...NOTHING, status: ended } : NOTHING;
    }
    // 2. The record on the page.
    const record = await resolveRecord();
    if (!record) {
      // Nothing to ask about a record, but the site and the switch are still checked now and then.
      if (!Number.isFinite(checkedAt) || at - checkedAt >= PROBE_MS) await probe(at);
      table = '';
      askedAt = NaN;
      actions = [];
      return ended ? { ...NOTHING, status: ended } : NOTHING;
    }
    if (needsAsk({ table: record.table, lastTable: table, lastAt: askedAt, now: at })) {
      const answer = await ask({ type: MSG.BAR_ACTIONS, table: record.table }, at);
      if (!answer) return { ...NOTHING, status: ended };
      // An error answer (the bar is not allowed for this table) means: show nothing for it.
      if (answer.error) actions = [];
      else {
        barOn = answer.bar !== false;
        actions = barOn ? cleanActions(answer.actions) : [];
      }
      table = record.table;
      askedAt = at;
      if (barOn !== true) return NOTHING;
    }
    const shown = { table: record.table, sysId: record.sysId };
    const said = language ? { language, theme } : {};
    return actions.length ? { status: 'shown', record: shown, actions, ...said } : { ...NOTHING, record: shown, ...said };
  }

  async function tick() {
    if (ended) return { ...NOTHING, status: ended };
    try {
      return await step();
    } catch (err) {
      if (isGone(err)) {
        ended = 'gone';
        return { ...NOTHING, status: 'gone' };
      }
      // The worker could not be reached for a moment: show nothing, and ask again after PROBE_MS rather than every look.
      barOn = null;
      checkedAt = now();
      table = '';
      askedAt = NaN;
      actions = [];
      return NOTHING;
    }
  }

  return { tick };
}
