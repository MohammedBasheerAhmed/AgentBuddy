import { RunBlocked } from '../lib/pipeline.js';
import { answerProblem, needsPreview } from './runLogic.js';

// The two halves of a run, without React: everything before the AI is called (permission, the read, the policy and the privacy
// filter, the decision about the preview) and the call itself. useRun.js keeps the state and shows the results; the dependencies
// come in as arguments so the order of steps, the audit and the way a run is dropped can be tested (tests/panel-run-flow.test.js).
//
// `isCurrent()` says whether the person still wants this run. Once it is false (Cancel, Close, another record, a newer run) the
// flow stops and reports 'abandoned': nothing is shown and nothing more is read or sent.

/**
 * Read the pack, apply policy and the privacy filter, and decide about the preview. Nothing is sent.
 * @returns {Promise<{ status: 'abandoned' } | { status: 'failed', error: Error } | { status: 'ready', prepared: object, preview: boolean }>}
 */
export async function prepareFlow({ feature, getPack, readPack, readOp, allowSensitive, config, values, policy, pageTable = '', isCurrent, deps }) {
  let pack;
  let prepared;
  try {
    // First, while the click is fresh: the browser's permission for the AI address (a prompt only the first time).
    await deps.ensureAiPermission(config);
    pack = await (getPack ? getPack() : readPack());
    if (!isCurrent()) return { status: 'abandoned' };
    // A feature may add more to its pack first (similar solved tickets, an account's other cases...). Whatever it adds is
    // untrusted text like the rest and reaches the AI only through feature.parts() and the firewall.
    if (typeof feature.enrich === 'function') {
      pack = await feature.enrich(pack, { read: readOp, allowSensitive });
      if (!isCurrent()) return { status: 'abandoned' };
    }
    // pageTable: the table of the form the person is on, so a pack labelled with a made-up table can not skip the table / HR rules.
    prepared = deps.prepareRun({ feature, pack, values, policy, config, pageTable, createFirewall: deps.createFirewall });
  } catch (err) {
    // Refused by policy or by the firewall (fail closed): nothing was sent. Record that.
    if (err instanceof RunBlocked || err?.name === 'FirewallError') {
      await deps.auditBlocked({ feature, pack, config, values, err, logAudit: deps.logAudit });
    }
    return isCurrent() ? { status: 'failed', error: err } : { status: 'abandoned' };
  }
  // The pack itself can ask for the preview even in "first time" mode (it carries other people's tickets: pack.requirePreview).
  const preview = needsPreview({ previewMode: values.previewMode, feature, pack: prepared.pack, seen: values.previewSeen || [], previewRequired: deps.previewRequired });
  return { status: 'ready', prepared, preview };
}

/**
 * Send a prepared request. The audit entry is written by executeRun whatever happens.
 * @returns {Promise<{ status: 'abandoned' } | { status: 'failed', error: Error } | { status: 'done', text: string }>}
 */
export async function sendFlow({ prepared, config, values, host, previewShown, policy = null, tokensUsedToday = null, isCurrent, deps }) {
  try {
    // policy + tokensUsedToday: the organisation's daily token budget is checked before anything is sent.
    const out = await deps.executeRun({ prepared, config, values, host, previewShown, policy, tokensUsedToday, sendChat: deps.sendChat, logAudit: deps.logAudit });
    if (!isCurrent()) return { status: 'abandoned' };
    // An answer with nothing in it is a failure the person should hear about, not an empty card.
    const empty = answerProblem(out.text);
    if (empty) return { status: 'failed', error: new Error(empty) };
    return { status: 'done', text: out.text };
  } catch (err) {
    return isCurrent() ? { status: 'failed', error: err } : { status: 'abandoned' };
  }
}
