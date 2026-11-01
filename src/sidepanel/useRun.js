import { useEffect, useRef, useState } from 'react';
import { contextFor } from '../features/registry.js';
import { peopleFor } from '../features/parts.js';
import { prepareRun, executeRun, previewRequired, auditBlocked, auditCancelled, maskMore as maskInRun } from '../lib/pipeline.js';
import { resolveProviderConfig } from '../providers/config.js';
import { ensureAiPermission } from '../lib/aiPermission.js';
import { sendChat } from '../providers/index.js';
import { MAX_ATTEMPTS, abortableSleep } from '../providers/http.js';
import { createFirewall } from '../pii/index.js';
import { logAudit, saveSettings } from '../lib/storage.js';
import { tokensTodayReader } from '../lib/aiUsage.js';
import { readBudgetState } from '../providers/budget.js';
import { expectFromPage } from '../lib/fillable.js';
import { read, plainError } from './ask.js';
import { internalTextsOf } from '../safeSend/review.js';
import { errorCodeOf, lastPackOf, makeTokens, seenAfterConfirm } from './runLogic.js';
import { prepareFlow, sendFlow } from './runFlow.js';

// What the flows need from the outside world (src/sidepanel/runFlow.js takes them as arguments so tests can replace them).
// Tokens used today across providers, for the organisation's daily budget (policy.tokenBudgetPerDay).
const tokensUsedToday = tokensTodayReader(async () => (await readBudgetState()).log);

const DEPS = { ensureAiPermission, prepareRun, previewRequired, auditBlocked, auditCancelled, createFirewall, logAudit, executeRun, sendChat };

/** A run that is doing something the person waits for (the actions are off meanwhile). */
export const isBusyPhase = (phase) => phase === 'reading' || phase === 'sending' || phase === 'preview';

/** The state of a run before anything happened (and after reset, apart from the last answer's people, scan and pack). */
export const IDLE_RUN = Object.freeze({
  phase: 'idle', // idle | reading | preview | sending | done | error
  active: null, // the feature of the last run
  meta: null, // what the caller passed as options.meta (the answer area labels a refinement with it)
  prepared: null, // { p, cfg } while the preview waits
  result: null,
  people: [], // everyone on the pack, for the safe-to-send check on what gets inserted
  scan: null, // the firewall's scan(): also recognises values it masked on the way out
  error: '',
  errorCode: '', // the machine code of the error (BAD_KEY, RATE_LIMIT, HR_BLOCKED...), for the next step it offers
  notice: '', // about the answer: it was cut short (from the provider layer)
  lastPack: null,
  source: null, // { expect, number }: the record that was open when the run started (Insert goes only there)
  since: 0, // when the current step started (ms): the answer area shows the seconds while the AI is asked
  attempt: 0, // the provider's try (2 and 3 after a busy answer)
  attempts: MAX_ATTEMPTS,
});

const hostOf = (page) => {
  try {
    return new URL(page.href).host;
  } catch {
    return '';
  }
};

/**
 * One run, from the click to the answer, without React: the steps of useRun as a small object that keeps its own state and tells
 * `onChange(state)` about every change. useRun holds one per view (and stops it when the view goes away); the Ticket screen's answer
 * area holds one per ticket in memory (src/sidepanel/ticket/assist/answers), so a run keeps going when the agent looks at another
 * ticket and its answer is kept for the ticket it was made for. Either way every AI call takes the same path:
 *
 *   permission for the AI address -> read the pack -> policy + firewall (mask, seal) -> preview (when required) -> provider
 *   -> re-hydrate -> audit
 *
 * @param {{ getEnv: () => { page, eff, record }, onChange?: Function, deps?: object, tokensUsed?: Function,
 *   rememberSeen?: (seen: string[]) => Promise|void, now?: () => number }} options
 *   getEnv: the page, the effective settings and the record as they are now (read at each step).
 */
export function createRunController({ getEnv, onChange = () => {}, deps = DEPS, tokensUsed = tokensUsedToday, rememberSeen = (seen) => saveSettings({ previewSeen: seen }), now = () => Date.now() }) {
  let state = IDLE_RUN;
  const tokens = makeTokens(); // a newer run (or reset) invalidates an older one still in flight
  let controller = null; // aborts the request in flight
  let lastOptions = {}; // so "Try again" re-reads the same thing
  // The prepared run the preview is about, read by Send and Cancel. Kept here as well as in the state: after "Mask this too" Send
  // must take the request that was just sealed again, never one a render behind (that one has less masked).
  let preparedNow = null;
  let started = null; // { page, eff, record } as the run started: it reads that record and binds the answer to it

  const set = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };
  const setPrepared = (next, patch = {}) => {
    preparedNow = next;
    set({ prepared: next, ...patch });
  };
  const abort = () => {
    controller?.abort();
    controller = null;
  };
  const env = () => getEnv() || started || {};

  function reset() {
    tokens.drop();
    abort();
    preparedNow = null;
    set({ phase: 'idle', prepared: null, result: null, error: '', errorCode: '', notice: '', since: 0, attempt: 0 });
  }

  /** Stop whatever is in flight and forget it, without telling anyone (the view went away). */
  function dispose() {
    tokens.drop();
    abort();
    preparedNow = null;
  }

  const fail = (err) => {
    preparedNow = null;
    set({ phase: 'error', prepared: null, error: plainError(err), errorCode: errorCodeOf(err), since: 0 });
  };

  async function send(p, cfg, previewShown, mine) {
    const { eff } = env();
    const page = started?.page || env().page;
    set({ phase: 'sending', since: now(), attempt: 1 });
    // One request at a time: an older one still in flight is stopped.
    abort();
    const own = new AbortController();
    controller = own;
    // The provider tries again after a "busy" answer (src/providers/http.js); the pause before each new try is the moment to say so.
    const counting = {
      ...deps,
      sendChat: (config, request, opts = {}) =>
        deps.sendChat(config, request, {
          ...opts,
          sleep: (ms, signal) => {
            if (tokens.isCurrent(mine)) set({ attempt: (state.attempt || 1) + 1 });
            return (opts.sleep || abortableSleep)(ms, signal);
          },
        }),
    };
    const out = await sendFlow({ prepared: p, config: cfg, values: eff.values, host: hostOf(page), previewShown, policy: eff.policy, tokensUsedToday: tokensUsed, signal: own.signal, isCurrent: () => tokens.isCurrent(mine), deps: counting });
    if (controller === own) controller = null;
    if (out.status === 'abandoned') return;
    if (out.status === 'failed') {
      fail(out.error);
      return;
    }
    set({
      phase: 'done',
      people: peopleFor(p.pack),
      scan: (text) => p.firewall.scan(text),
      // (madeWithout: what the request was made without, in plain words, from the pipeline: the line under the answer)
      lastPack: { ...lastPackOf(p.pack, internalTextsOf), ...(Array.isArray(p.madeWithout) ? { madeWithout: p.madeWithout } : {}) },
      notice: out.notice || '',
      result: out.text,
      since: 0,
    });
  }

  /**
   * Start a run. options.getPack: `async () => ContextPack` (default: the open record's pack, read with the feature's context spec);
   * options.meta: anything the caller wants back with the answer (kept in the state as `meta`).
   */
  async function run(feature, options = {}) {
    const mine = tokens.next();
    lastOptions = options || {};
    abort();
    preparedNow = null;
    const e = env();
    started = e;
    const { page, eff, record } = e;
    set({
      phase: 'reading',
      active: feature,
      meta: lastOptions.meta ?? null,
      prepared: null,
      result: null,
      error: '',
      errorCode: '',
      notice: '',
      source: { expect: expectFromPage(page), number: page?.record?.number || '' },
      since: now(),
      attempt: 0,
    });
    const allowSensitive = Boolean(eff.policy?.allowHrContent);
    const cfg = resolveProviderConfig(eff.values, eff.apiKey);
    const out = await prepareFlow({
      feature,
      getPack: lastOptions.getPack,
      readPack: () => read(page.tabId, 'pack', { table: record?.table, sysId: record?.sysId, feature: contextFor(feature), allowSensitive }),
      readOp: (op, args) => read(page.tabId, op, args),
      allowSensitive,
      config: cfg,
      values: eff.values,
      policy: eff.policy,
      pageTable: page?.record?.table || page?.newRecord?.table || '',
      isCurrent: () => tokens.isCurrent(mine),
      deps,
    });
    if (out.status === 'abandoned') return;
    if (out.status === 'failed') {
      fail(out.error);
      return;
    }
    if (out.preview) {
      setPrepared({ p: out.prepared, cfg }, { phase: 'preview', since: 0 });
    } else {
      await send(out.prepared, cfg, false, mine);
    }
  }

  /** Send after the check. opts.shown === false: the person confirmed the short check without opening the text (audited so). */
  async function confirmPreview(opts) {
    const current = preparedNow;
    if (!current) return; // already sent or cancelled (a second click)
    const { p, cfg } = current;
    const mine = tokens.current();
    const { eff } = env();
    // "first time per feature" (or per group of features): remember that this one has been checked.
    const before = eff.values.previewSeen || [];
    const seen = seenAfterConfirm({ previewMode: eff.values.previewMode, feature: p.feature, seen: before });
    if (seen !== before) Promise.resolve().then(() => rememberSeen(seen)).catch(() => {});
    setPrepared(null);
    await send(p, cfg, opts?.shown !== false, mine);
  }

  async function cancelPreview() {
    const current = preparedNow;
    if (!current) return;
    const { p, cfg } = current;
    setPrepared(null);
    await deps.auditCancelled({ feature: p.feature, pack: p.pack, config: cfg, values: env().eff.values, stats: p.stats, logAudit: deps.logAudit });
    reset();
  }

  /**
   * "Mask this too" in the preview: the same firewall masks `text` as well and seals the request again (src/lib/pipeline.js
   * maskMore). Returns { ok, masked } or { ok: false, problem } for the dialog to say what happened.
   */
  function maskMore(text) {
    const current = preparedNow;
    if (!current) return { ok: false, problem: 'GONE' };
    const out = maskInRun(current.p, text);
    if (out.ok) setPrepared({ ...current, p: out.prepared });
    return out.ok ? { ok: true, masked: out.masked } : { ok: false, problem: out.problem };
  }

  const again = () => (state.active ? run(state.active, lastOptions) : undefined);

  return { getState: () => state, run, again, reset, dispose, confirmPreview, cancelPreview, maskMore };
}

/**
 * The one way a view runs an AI feature. It owns the whole flow and nothing can skip a step:
 *
 *   run(feature, { getPack })   permission for the AI address -> read the pack -> policy + firewall (mask, seal)
 *                               -> preview (when required) -> provider -> re-hydrate -> audit
 *
 * `getPack` is `async () => ContextPack`. The default reads the open record's pack with the feature's context spec. A view
 * that works on something other than one record (a queue report, text the agent pasted, a chat) builds a ContextPack-shaped
 * object itself: { table, sysId, number?, kind?, fields, people, journal, related, access }. `table` and `sysId` only
 * label the audit entry (use a made-up table such as 'report' for non-record input). Whatever text is in `fields`, `journal`
 * or custom `feature.parts(pack)` goes through the firewall like everything else.
 *
 * Render the returned `run` object with <RunPanel run={run} ... />.
 *
 * A run the person abandons (Stop waiting, Close, another record, the view going away) has its request aborted (an AbortController
 * per send); a request the provider had already answered may still be audited as sent, but its answer is dropped and never shown
 * (the steps and decisions are in createRunController above, runFlow.js and runLogic.js).
 */
export function useRun({ page, eff, record }) {
  const envRef = useRef(null);
  envRef.current = { page, eff, record };
  const [state, setState] = useState(IDLE_RUN);
  const ctl = useRef(null);
  if (!ctl.current) ctl.current = createRunController({ getEnv: () => envRef.current, onChange: setState });
  // The view went away (another record, the panel closed): stop the request in flight, and anything still being read.
  useEffect(() => () => ctl.current.dispose(), []);
  const c = ctl.current;
  return {
    ...state,
    busy: isBusyPhase(state.phase),
    run: c.run,
    again: c.again,
    reset: c.reset,
    confirmPreview: c.confirmPreview,
    cancelPreview: c.cancelPreview,
    maskMore: c.maskMore,
  };
}
