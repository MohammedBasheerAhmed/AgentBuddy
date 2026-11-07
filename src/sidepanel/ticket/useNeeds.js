import { useEffect, useRef, useState } from 'react';
import { buildGlance } from '../../insights/glance.js';
import { latestCallerMessage, needsTranslation, sinceLooked } from '../../insights/sinceLooked.js';
import { LAST_VIEWED_KEY, chromeLastViewedStore, instanceOf, lastViewedAllowed, worthRemembering } from '../../lib/lastViewed.js';
import { SYS_ID_RE } from '../../context/util.js';
import { featureById } from '../../features/registry.js';
import { TRANSLATE_ID } from '../../features/packs/translate.js';
import { aiOffByPolicy } from '../../profiles/profiles.js';
import { offeredFeatures } from './assist/actions/plan.js';
import { useRecordRead, useTicketFacts } from './cards/data.js';
import { needsNow } from './needsNow.js';
import { getLanguage } from '../../i18n/index.js';

// ---- "since you last looked": when the panel showed this ticket before ---------------------------------------------------------
//
// The ticket on screen and the time it was shown before, in panel memory: read from storage ONCE when the Ticket screen shows a record
// (src/lib/lastViewed.js, which then keeps "now"), and kept while that record stays on screen. The screen drawn again for the same
// record (another language, a part that failed and came back) does not read again, which would find the time just written.
let shown = { key: '', previous: null, promise: Promise.resolve(null) };

/**
 * The key a record is remembered under, or '' when nothing is to be read or written: the policy turns it off, the page has no instance
 * address, the page does not say who is signed in (whose time it would be is not known: R-17), or the page is not a ticket's (the table
 * is not a ticket-like one and the form carried no number). The key is in memory only; the user id in it is never stored (storage
 * keeps a hash: src/lib/lastViewed.js). Pure.
 */
export function lastViewedKey({ allowed, instance, record, extraPrefixes, userId = '' }) {
  const table = String(record?.table || '');
  const sysId = String(record?.sysId || '').toLowerCase();
  const user = String(userId || '').toLowerCase();
  const proven = typeof record?.number === 'string' && record.number.trim() !== '';
  return allowed && instance && SYS_ID_RE.test(user) && SYS_ID_RE.test(sysId) && worthRemembering(table, { proven, extraPrefixes }) ? `${instance}|${user}|${table}|${sysId}` : '';
}

/** Forget the time held in memory (tests; "Clear everything" in Settings, through storage). */
export function forgetLastViewed() {
  shown = { key: '', previous: null, promise: Promise.resolve(null) };
}

/**
 * When the panel last showed this record before now (ms), or null: the first time, while it is being read, when the organisation's
 * policy turns it off (`rememberLastViewed: false`: nothing is read or written then), or for a page without an instance address.
 * @param {{ page: { href?: string }, record: { table: string, sysId: string }, eff: { policy?: object } }} input
 */
export function useLastViewed({ page, record, eff }) {
  const allowed = lastViewedAllowed(eff?.policy);
  const allowedNow = useRef(allowed);
  allowedNow.current = allowed;
  const instance = instanceOf(page?.href);
  const table = String(record?.table || '');
  const sysId = String(record?.sysId || '').toLowerCase();
  const extraPrefixes = eff?.policy?.sensitiveTablePrefixes;
  const proven = typeof record?.number === 'string' && record.number.trim() !== '';
  // Who is signed in (the page says; the store keeps only a short hash of it): "since you last looked" is the visit of THIS person.
  const userId = String(page?.user?.userId || '').toLowerCase();
  const key = lastViewedKey({ allowed, instance, record, extraPrefixes, userId });
  const [state, setState] = useState(() => ({ key: shown.key === key ? key : '', previous: shown.key === key ? shown.previous : null }));

  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    if (shown.key !== key) {
      // The policy is asked again right before the store reads or writes (it may have changed since this record was opened).
      const store = chromeLastViewedStore({ enabled: () => allowedNow.current });
      const entry = { key, previous: null, promise: null };
      entry.promise = (store ? store.seen({ instance, userId, table, sysId, proven, extraPrefixes }) : Promise.resolve(null))
        .catch(() => null)
        .then((previous) => {
          entry.previous = Number.isFinite(previous) ? previous : null;
          return entry.previous;
        });
      shown = entry;
    }
    const entry = shown;
    entry.promise.then((previous) => {
      if (alive && shown === entry) setState({ key, previous });
    });
    return () => {
      alive = false;
    };
    // the key names the instance, the table and the record
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // "Clear everything" in Settings removes the stored times: the one held for the ticket on screen goes too.
  useEffect(() => {
    const onChanged = typeof chrome !== 'undefined' ? chrome.storage?.onChanged : null;
    if (!onChanged || typeof onChanged.addListener !== 'function') return undefined;
    const listener = (changes, area) => {
      if (area !== 'local' || !changes || !Object.prototype.hasOwnProperty.call(changes, LAST_VIEWED_KEY) || changes[LAST_VIEWED_KEY]?.newValue !== undefined) return;
      shown = { key: shown.key, previous: null, promise: Promise.resolve(null) };
      setState((s) => (s.previous === null ? s : { ...s, previous: null }));
    };
    onChanged.addListener(listener);
    return () => onChanged.removeListener(listener);
  }, []);

  return key && state.key === key ? state.previous : null;
}

/** Is "Translate the caller's message" offered on this record, as AI Assist would offer it (kind, policy, profiles, state)? */
export function translateOffered({ record, header, eff }) {
  if (aiOffByPolicy(eff)) return false;
  const feature = featureById(TRANSLATE_ID);
  return Boolean(feature) && offeredFeatures({ record, header, eff, features: [feature] }).length > 0;
}

// The SLA rows are a fact only when task_sla could be read (as the Glance and the journey take them).
const slasOf = (answer) => {
  const access = Array.isArray(answer?.slas?.access) ? answer.slas.access : [];
  return Array.isArray(answer?.slas?.items) && access.every((a) => a?.status === 'ok' || a?.status === 'empty') ? answer.slas.items : null;
};

/**
 * What needs the agent now on the record on screen (needsNow.js: the SLA, a customer waiting, a possible outage), for the first rows of
 * "Understand the ticket" (its line and its dot, and so the number on the Insights tab). It listens to the Glance's read and makes
 * none of its own (`active: false`: the Glance at the top always reads it), with a clock that moves once a minute ("due in 40 min").
 *
 * Round 4: before them, what changed since the agent last opened this ticket (src/insights/sinceLooked.js; the time from
 * useLastViewed) and what the caller wrote last, with "Translate" when it is in another script than the panel's and the action is
 * offered. The field history for "since" is the journey's own read (`journey`, shared with the Ticket journey card), asked for only
 * when there is a time to compare with.
 * @param {{ page, record, eff, header, headPhase: string, cards: { id: string }[] }} input   cards: the Insights cards drawn in the list
 */
export function useNeeds({ page, record, eff, header, headPhase, cards }) {
  const facts = useTicketFacts({ page, record, eff, active: false });
  const previous = useLastViewed({ page, record, eff });
  const language = getLanguage();
  const audit = useRecordRead({ page, record, eff, active: Number.isFinite(previous), op: 'journey', args: { language }, name: `journey:${language}` });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setNow(Date.now()), [facts.at]);
  // Right after the record changed the hook may still hold the last record's answer for one draw: never this record's facts then.
  const sysId = String(facts.data?.pack?.sysId || '').toLowerCase();
  const answer = sysId && sysId !== String(record?.sysId || '').toLowerCase() ? null : facts.data;
  const pack = answer?.pack && typeof answer.pack === 'object' ? answer.pack : null;
  const since = pack && Number.isFinite(previous) ? sinceLooked({ previous, pack, audit: audit.data || null, slas: slasOf(answer), now }) : null;
  const message = pack ? latestCallerMessage(pack, now) : null;
  const caller = message ? { ...message, translate: needsTranslation(message.text) && translateOffered({ record, header, eff }) } : null;
  return needsNow({ glance: buildGlance({ record, header, headPhase, answer, now }), cards, since, caller });
}
