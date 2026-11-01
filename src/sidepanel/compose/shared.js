// Small helpers shared by the Write section's panels.
import React, { useCallback, useRef, useState } from 'react';
import { auditInsert } from '../../lib/storage.js';
import { read } from '../ask.js';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import { reviewForInsert } from '../../safeSend/review.js';
import { buildFillMessage, auditRefFromPage, fillReasonText, isCustomerVisible, sourceFromPack } from '../../lib/fillable.js';
import { createGuard, performInsert } from '../insertFlow.js';
import { resolveProviderConfig } from '../../providers/config.js';
import ReviewHints from '../ReviewHints.jsx';
import { t } from '../../i18n/index.js';

export { ReviewHints };

// One rule for "is the AI ready" everywhere (a key, a key the organisation provides, or a model that needs none): src/sidepanel/aiReady.js.
export { isAiReady } from '../aiReady.js';

/** A feature by id, and whether the organisation's policy lets it run. */
export function featureState(id, policy) {
  const feature = featureById(id);
  return { feature, available: Boolean(feature) && isFeatureAvailable(feature, policy) };
}

export const fillReason = fillReasonText;

/**
 * Ask the page to put text into ONE field of the open form (FILL_FIELD). It never saves: the person presses Save.
 * mode 'append' adds below what the field holds; anything else replaces it (a one-line field is always replaced).
 * `expect` is the record the text was written for ({ table, sysId } or { table, newRecord: true }): the content script refuses
 * with 'wrong-record' when another form is open. Left out, it means "the page as it is now"; pass null for "any form".
 * @returns {Promise<{ ok: boolean, reason?: string, method?: string, label?: string }>}
 */
export async function fillField(page, { field, value, label = '', mode = 'replace', expect }) {
  try {
    const answer = await chrome.tabs.sendMessage(page.tabId, buildFillMessage({ field, value, label, mode, expect, page }));
    return answer && typeof answer === 'object' && !answer.error ? answer : { ok: false, reason: 'no-form' };
  } catch {
    return { ok: false, reason: 'no-form' };
  }
}

/**
 * The people of the open record, so a rewrite or notes run can mask them by name. Best effort: a record that cannot be read
 * just means fewer names are known (the person can list names to hide, and the preview shows what is sent).
 * @returns {Promise<{ people: object[], ok: boolean }>}
 */
export async function readRecordPeople(page, eff) {
  if (!page.record) return { people: [], ok: true };
  try {
    const pack = await read(page.tabId, 'pack', { table: page.record.table, sysId: page.record.sysId, feature: 'compose-people', allowSensitive: Boolean(eff.policy?.allowHrContent) });
    return { people: Array.isArray(pack?.people) ? pack.people : [], ok: true };
  } catch {
    return { people: [], ok: false };
  }
}

/**
 * Insert and copy for the Write panels, with the review in front of anything that goes into a form.
 *   insert({ field, value, label, mode, key?, expect?, number? }, { people, scan, internalTexts, internalPhrases, force })
 *     The review (src/safeSend/review.js) looks at the text for the field it goes into; serious findings are held in `findings`
 *     until the person chooses.
 *     expect: the record the text was written for (see fillField); number: its number, for the message when it is not open.
 *     key: names the button, so it can say "Inserted" afterwards.
 * `run` (from useRun) is optional: when given, its people and scan feed the check. `feature` names the action in the audit log
 * for inserts that did not come from a run (a snippet). Every successful insert or copy lands in the audit log, without content.
 *
 * `busy` is true while a FILL_FIELD call is in flight: disable every insert button with it. `inserted[key]` is true after a
 * successful insert until clear() (a new draft, Try again, Close): the button then says "Inserted".
 */
export function useFill({ page, eff, run, feature = '' }) {
  const [note, setNote] = useState(null); // { kind: 'ok' | 'danger' | 'warn', text }
  const [findings, setFindings] = useState(null); // { items, hints, spec, people, scan, internalTexts, internalPhrases }
  const [busy, setBusy] = useState(false);
  const [inserted, setInserted] = useState({});
  const guard = useRef(null); // one insert at a time, decided at once (not at the next render)
  if (!guard.current) guard.current = createGuard();

  const audit = useCallback(
    (outcome) => {
      // The record the text went into: the run's own record, or (a pasted text, a snippet) the record that is open.
      const ref = sourceFromPack(run?.lastPack) ? run.lastPack : auditRefFromPage(page);
      let config = {};
      try {
        config = run?.active ? resolveProviderConfig(eff.values, eff.apiKey) : {};
      } catch {
        config = {};
      }
      auditInsert({
        feature: run?.active?.id || feature,
        table: ref.table,
        sysId: ref.sysId,
        provider: config.provider,
        model: config.model,
        mode: eff.values?.piiMode,
        outcome,
      });
    },
    [run, eff, page, feature]
  );

  const copy = useCallback(
    async (value, why = '') => {
      try {
        await navigator.clipboard.writeText(String(value ?? ''));
        setNote({ kind: 'ok', text: why ? `${why} ${t('Copied to the clipboard instead.')}` : t('Copied to the clipboard.') });
        audit('copied');
        return true;
      } catch {
        setNote({ kind: 'danger', text: t('The browser blocked copying. Select the text and copy it by hand.') });
        return false;
      }
    },
    [audit]
  );

  const insert = useCallback(
    async (spec, { people, scan, internalTexts, internalPhrases, force = false } = {}) => {
      setNote(null);
      const value = String(spec.value ?? '');
      if (!value.trim()) {
        setNote({ kind: 'danger', text: t('There is nothing to insert.') });
        return null;
      }
      const key = spec.key || `${spec.field}:${spec.mode || ''}`;
      // One insert at a time; a second click while the first is in flight (or after it worked) does nothing.
      const outcome = await guard.current.run(key, async () => {
        setBusy(true);
        try {
          return await performInsert({
            page,
            spec,
            value,
            force,
            expect: spec.expect,
            number: spec.number,
            // The organisation's internal-only phrases (policy) are checked on top of the built-in ones.
            review: {
              people: people ?? run?.people ?? [],
              scan: scan ?? run?.scan ?? null,
              internalTexts: internalTexts ?? run?.lastPack?.internalTexts ?? [],
              internalPhrases: internalPhrases ?? eff.policy?.internalPhrases ?? [],
            },
            send: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
          });
        } finally {
          setBusy(false);
        }
      });
      if (!outcome) return null;
      if (outcome.status === 'findings') {
        setFindings({ items: outcome.items, hints: outcome.hints, spec, people, scan, internalTexts, internalPhrases });
        return null;
      }
      setFindings(null);
      if (outcome.status === 'inserted') {
        setNote({ kind: 'ok', text: outcome.note });
        setInserted((prev) => ({ ...prev, [key]: true }));
        audit('inserted');
      } else {
        await copy(value, outcome.why);
      }
      return outcome.answer;
    },
    [page, run, eff, audit, copy]
  );

  const clear = useCallback(() => {
    setNote(null);
    setFindings(null);
    setInserted({});
    guard.current.reset();
  }, []);

  return { note, setNote, findings, setFindings, busy, inserted, insert, copy, clear, audit };
}

/** The non-blocking findings for text that is about to go into `field` (what ReviewHints shows before the person presses Insert). */
export function hintsFor(field, text, { people, scan, internalTexts, internalPhrases } = {}) {
  if (!isCustomerVisible(field) || !String(text || '').trim()) return [];
  return reviewForInsert(field, text, { people, scan, internalTexts, internalPhrases }).hints;
}

/** The warning and the result line that go with useFill(). */
export function FillFeedback({ fill }) {
  const { findings, note } = fill;
  return (
    <>
      {findings && (
        <div className="ab-note ab-note-warn" role="alert">
          <strong>{isCustomerVisible(findings.spec.field) ? t('Check before sending to the customer:') : t('Check before inserting:')}</strong>
          <ul className="ab-compose-list">
            {findings.items.map((f, i) => (
              <li key={i}>
                {f.advice} <span className="ab-mono">{f.excerpt}</span>
              </li>
            ))}
          </ul>
          <ReviewHints hints={findings.hints} />
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" disabled={fill.busy} onClick={() => fill.insert(findings.spec, { people: findings.people, scan: findings.scan, internalTexts: findings.internalTexts, internalPhrases: findings.internalPhrases, force: true })}>
              {t('Insert anyway')}
            </button>
            <button
              type="button"
              className="ab-btn ab-btn-sm"
              disabled={fill.busy}
              onClick={() => {
                const value = findings.spec.value;
                fill.setFindings(null);
                fill.copy(value, t('Not inserted.'));
              }}
            >
              {t('Edit first (copy instead)')}
            </button>
          </div>
        </div>
      )}
      {note && (
        <p className={`ab-note ab-note-${note.kind}`} role="status">
          {note.text}
        </p>
      )}
    </>
  );
}
