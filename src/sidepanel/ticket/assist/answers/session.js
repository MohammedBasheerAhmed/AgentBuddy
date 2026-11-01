// The Ticket screen's runs and answers for this panel, one run controller per ticket (memory only; see store.js for why).
//
// A run belongs to the ticket it was started on, not to the view: the agent can open another ticket, another screen or the Insights
// half while it reads, waits for the preview or waits for the AI, and it carries on. A finished answer goes into that ticket's list;
// a preview waits there (parked) until the agent comes back to that ticket. Nothing is shown on another ticket, so an answer can
// never be inserted into the wrong form. Every run is useRun's own flow (createRunController): permission, read, policy, firewall,
// preview, provider, audit; there is no second way to call the AI here.
import { createRunController, IDLE_RUN } from '../../../useRun.js';
import { mergePeople } from '../../../../compose/rewrite.js';
import { createAnswerStore, keyOf, RECORDS_KEPT } from './store.js';

export { keyOf };

export const store = createAnswerStore();

const runs = new Map(); // key -> { key, ctl, state, page, record, number, opener }
let latest = { page: null, eff: null, key: '' }; // the answer area's last render: eff for every run, the page for the ticket on show
const listeners = new Set();
let version = 0;

function emit() {
  version += 1;
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      // one listener failing must not stop the others
    }
  }
}
store.subscribe(emit);

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getVersion = () => version;

/** The view tells the session what is on screen (called while it renders): the newest settings reach every run from here. */
export function setLatest(page, eff) {
  latest = { page, eff, key: keyOf(page, page?.record) };
}

/** The Ticket screen went away: no ticket is on show (the settings stay, for the runs still going on). */
export function leaveScreen() {
  latest = { page: null, eff: latest.eff, key: '' };
}

// A finished run: its answer joins the ticket's list (marked unseen when that ticket is not on screen), and the run is free again.
// A refinement is about the same ticket as the answer it came from: it keeps that answer's record, work notes and people (`carry`),
// so the check before an insert still knows what is internal on that ticket (the rewrite itself only sent the answer's text).
function take(entry, s) {
  if (s.phase !== 'done' || s.result === null) return;
  // (a page found by its address may not know the number; the pack does, for the line shown on other tickets)
  if (!entry.number && s.lastPack?.number) entry.number = s.lastPack.number;
  const { carry, ...meta } = s.meta || {};
  store.add(entry.key, {
    feature: s.active,
    meta: s.meta ? meta : null,
    text: s.result,
    notice: s.notice,
    people: carry?.people ? mergePeople(carry.people, s.people) : s.people,
    scan: s.scan,
    lastPack: carry?.lastPack || s.lastPack,
    source: carry?.source || s.source,
    // what started it, so "Try again" on this answer asks the same thing again (the same question, the same refinement)
    options: entry.runOptions || {},
    unseen: latest.key !== entry.key,
  });
  entry.ctl.reset();
}

/** Start a run on a ticket. Remembers the options with the run, so its answer can be asked again. */
export function startRun(key, page, record, feature, options = {}) {
  const entry = runFor(key, page, record);
  entry.runOptions = options;
  return entry.ctl.run(feature, options);
}

// Runs of tickets that are not on screen and have nothing going on are dropped once there are more than the store keeps.
function prune() {
  if (runs.size <= RECORDS_KEPT) return;
  for (const [key, r] of runs) {
    if (runs.size <= RECORDS_KEPT) break;
    if (key !== latest.key && (r.state.phase === 'idle' || r.state.phase === 'error')) runs.delete(key);
  }
}

/** The run of one ticket (made the first time it is needed). */
export function runFor(key, page, record) {
  let entry = runs.get(key);
  if (!entry) {
    entry = { key, ctl: null, state: IDLE_RUN, page, record, number: record?.number || page?.record?.number || '', opener: null };
    const env = () => ({ eff: latest.eff, page: latest.key === key ? latest.page : entry.page, record: entry.record });
    entry.ctl = createRunController({
      getEnv: env,
      onChange: (s) => {
        entry.state = s;
        if (s.phase === 'done') take(entry, s);
        emit();
      },
    });
    runs.set(key, entry);
    prune();
  }
  if (page) entry.page = page;
  if (record) {
    entry.record = record;
    entry.number = record.number || entry.number;
  }
  return entry;
}

/** The run of a ticket if there is one (null otherwise): reading the state never makes one. */
export const peekRun = (key) => runs.get(key) || null;

/** Every ticket's run, for the line about other tickets: { key, phase, number }. */
export const allRuns = () => [...runs.values()].map((r) => ({ key: r.key, phase: r.state.phase, number: r.number }));

/** Forget every answer and stop every run (the site was turned off, Settings "Clear all", a test). */
export function forgetAnswers() {
  for (const r of runs.values()) r.ctl.dispose();
  runs.clear();
  store.forget();
  emit();
}
