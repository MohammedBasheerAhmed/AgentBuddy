// Small helpers shared by the Write section's panels.
import React, { useCallback, useState } from 'react';
import { MSG } from '../../lib/messages.js';
import { logAudit } from '../../lib/storage.js';
import { read } from '../ask.js';
import { featureById, isFeatureAvailable } from '../../features/registry.js';
import { seriousFindings } from '../../compose/sendCheck.js';

/** Same rule RecordView uses: a key (or a key the organisation provides, or a local model) is there. */
export const isAiReady = (eff) => Boolean(eff.apiKey) || Boolean(eff.values?.providedApiKey) || ['ollama'].includes(eff.values?.provider);

export const aiNotReadyText = (eff) => (eff.keyLocked ? 'Your AI key is locked. Unlock it in Settings.' : 'Add an AI key in Settings to use this.');

/** A feature by id, and whether the organisation's policy lets it run. */
export function featureState(id, policy) {
  const feature = featureById(id);
  return { feature, available: Boolean(feature) && isFeatureAvailable(feature, policy) };
}

const FILL_REASONS = {
  'no-form': 'Agent Buddy could not reach a form field on this page.',
  'no-such-field': 'That field is not on this form.',
  'read-only': 'That field is read-only on this form.',
  'too-long': 'The text is too long to insert.',
  'set-failed': 'The form did not accept the text.',
  'bad-field': 'That field cannot be filled.',
};
export const fillReason = (reason) => FILL_REASONS[reason] || 'Could not insert it.';

/**
 * Ask the page to put text into ONE field of the open form (FILL_FIELD). It never saves: the person presses Save.
 * mode 'append' adds below what the field holds; anything else replaces it.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function fillField(page, { field, value, label = '', mode = 'replace' }) {
  try {
    const answer = await chrome.tabs.sendMessage(page.tabId, { type: MSG.FILL_FIELD, field, value, label, mode: mode === 'append' ? 'append' : 'replace' });
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
 * Insert and copy for the Write panels, with the safe-to-send check in front of anything the customer can read.
 *   insert({ field, value, label, mode, check }, { people, scan, force })
 *     check: true runs the check; findings are held in `findings` until the person chooses
 * `run` (from useRun) is optional: when given, its people and scan feed the check and the audit log gets "inserted" / "copied".
 */
export function useFill({ page, eff, run }) {
  const [note, setNote] = useState(null); // { kind: 'ok' | 'danger' | 'warn', text }
  const [findings, setFindings] = useState(null); // { items, spec, people, scan }

  const audit = useCallback(
    (outcome) => {
      if (!run?.active) return;
      logAudit({
        feature: run.active.id,
        table: run.lastPack?.table,
        sysId: run.lastPack?.sysId,
        provider: eff.values?.provider,
        model: eff.values?.models?.[eff.values?.provider] || '',
        mode: eff.values?.piiMode,
        outcome,
      });
    },
    [run, eff]
  );

  const copy = useCallback(
    async (value, why = '') => {
      try {
        await navigator.clipboard.writeText(String(value ?? ''));
        setNote({ kind: 'ok', text: why ? `${why} Copied to the clipboard instead.` : 'Copied to the clipboard.' });
        audit('copied');
        return true;
      } catch {
        setNote({ kind: 'danger', text: 'The browser blocked copying. Select the text and copy it by hand.' });
        return false;
      }
    },
    [audit]
  );

  const insert = useCallback(
    async (spec, { people, scan, force = false } = {}) => {
      setNote(null);
      const value = String(spec.value ?? '');
      if (!value.trim()) {
        setNote({ kind: 'danger', text: 'There is nothing to insert.' });
        return null;
      }
      if (!force && spec.check) {
        const serious = seriousFindings(value, people ?? run?.people ?? [], scan ?? run?.scan ?? null);
        if (serious.length) {
          setFindings({ items: serious, spec, people, scan });
          return null;
        }
      }
      setFindings(null);
      const answer = await fillField(page, spec);
      if (answer.ok) {
        setNote({ kind: 'ok', text: 'Inserted into the form. Review it, then save the record yourself.' });
        audit('inserted');
      } else {
        await copy(value, fillReason(answer.reason));
      }
      return answer;
    },
    [page, run, audit, copy]
  );

  const clear = useCallback(() => {
    setNote(null);
    setFindings(null);
  }, []);

  return { note, setNote, findings, setFindings, insert, copy, clear, audit };
}

/** The warning and the result line that go with useFill(). */
export function FillFeedback({ fill }) {
  const { findings, note } = fill;
  return (
    <>
      {findings && (
        <div className="ab-note ab-note-warn" role="alert">
          <strong>Check before sending to the customer:</strong>
          <ul className="ab-compose-list">
            {findings.items.map((f, i) => (
              <li key={i}>
                {f.advice} <span className="ab-mono">{f.excerpt}</span>
              </li>
            ))}
          </ul>
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" onClick={() => fill.insert(findings.spec, { people: findings.people, scan: findings.scan, force: true })}>
              Insert anyway
            </button>
            <button
              type="button"
              className="ab-btn ab-btn-sm"
              onClick={() => {
                const value = findings.spec.value;
                fill.setFindings(null);
                fill.copy(value, 'Not inserted.');
              }}
            >
              Edit first (copy instead)
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
