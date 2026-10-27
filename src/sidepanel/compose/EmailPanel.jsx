import React, { useCallback, useEffect, useRef, useState } from 'react';
import { read } from '../ask.js';
import { contextFor } from '../../features/registry.js';
import { useRun } from '../useRun.js';
import RunPanel from '../RunPanel.jsx';
import { openUrl } from '../openRecord.js';
import { parseSafeText, toPlainText } from '../../render/safeText.js';
import { recommendEmails, parseEmailDraft, emailFormUrl, EMAIL_TYPES } from '../../compose/emailRecommend.js';
import { internalTextsOf } from '../../safeSend/review.js';
import { currentFromPage, emailClientTarget, matchesExpect } from '../../lib/fillable.js';
import { FillFeedback, ReviewHints, aiNotReadyText, featureState, hintsFor, isAiReady, useFill } from './shared.js';

const isEmailFeature = (feature) => Boolean(feature?.id) && EMAIL_TYPES.some((t) => t.featureId === feature.id);

/** One suggested (or other) kind of email, with its Draft button. */
function TypeRow({ type, why, primary, disabled, offReason, onDraft }) {
  return (
    <li className="ab-compose-row">
      <div className="ab-compose-row-text">
        <span className="ab-compose-row-title">{type.label}</span>
        <span className="ab-sub">{why || type.blurb}</span>
        {offReason && <span className="ab-locked">{offReason}</span>}
      </div>
      <button type="button" className={`ab-btn ab-btn-sm${primary ? ' ab-btn-primary' : ''}`} disabled={disabled} onClick={onDraft} aria-label={`Draft: ${type.label}`}>
        Draft
      </button>
    </li>
  );
}

/** Below the draft: copy it, open the email form, try to put the body into it. Copy always works. */
export function DraftActions({ page, run, fill, target, internalTexts }) {
  const plain = toPlainText(parseSafeText(run.result || ''));
  const draft = parseEmailDraft(plain);
  const url = target ? emailFormUrl(page.href, target) : '';
  const [opened, setOpened] = useState(false);
  // The body goes into the email form of the record the draft is for, and nowhere else.
  const expect = target ? { email: true, table: target.table, sysId: target.sysId } : null;
  const onOtherEmail = Boolean(expect) && Boolean(emailClientTarget(page.href)) && !matchesExpect(expect, currentFromPage(page));

  return (
    <section className="ab-card ab-compose-actions" aria-label="Use the draft">
      <h3 className="ab-h">Use the draft</h3>
      <div className="ab-row">
        <button type="button" className="ab-btn ab-btn-sm" disabled={!draft.subject} onClick={() => fill.copy(draft.subject)}>
          Copy subject
        </button>
        <button type="button" className="ab-btn ab-btn-sm" disabled={!draft.body} onClick={() => fill.copy(draft.body)}>
          Copy body
        </button>
      </div>
      <div className="ab-row">
        <button
          type="button"
          className="ab-btn ab-btn-sm ab-btn-primary"
          disabled={!url}
          onClick={() => setOpened(openUrl(page, url))}
        >
          Open the email form
        </button>
        <button
          type="button"
          className="ab-btn ab-btn-sm"
          disabled={!draft.body || fill.busy || fill.inserted.body || onOtherEmail}
          onClick={() => fill.insert({ field: 'body', value: draft.body, label: 'Body', mode: 'append', key: 'body', expect }, { internalTexts })}
        >
          {fill.inserted.body ? 'Inserted' : 'Insert into the email body'}
        </button>
      </div>
      <ReviewHints hints={hintsFor('body', draft.body, { people: run.people, scan: run.scan, internalTexts })} />
      {onOtherEmail && <p className="ab-note ab-note-warn" role="status">This email form is for another ticket. Open the email form for this draft again, or use Copy.</p>}
      <FillFeedback fill={fill} />
      <p className="ab-hint">
        {opened ? 'The email form is opening in this tab. When it is ready, press Insert, or paste what you copied. ' : ''}
        Insert only works when the email form is open on this page; Copy always works. Nothing is sent until you press Send in the form.
      </p>
    </section>
  );
}

export default function EmailPanel({ page, eff, active }) {
  const record = page.record;
  const run = useRun({ page, eff, record });
  const fill = useFill({ page, eff, run });
  const [recs, setRecs] = useState({ state: 'idle', value: null, error: '' });
  const [target, setTarget] = useState(null); // the record the current draft is for (kept when the page moves on to the email form)
  const [internalTexts, setInternalTexts] = useState([]); // that record's work notes, for the check on the draft (memory only)
  const token = useRef(0);
  const lastKey = useRef('');
  const key = record ? `${record.table}:${record.sysId}` : '';
  const aiReady = isAiReady(eff);

  // A different record means a different email: drop the old suggestions and draft. Leaving the record for the email form
  // (no record) keeps the draft, so Insert can still work there.
  useEffect(() => {
    if (!key || key === lastKey.current) return;
    if (lastKey.current) {
      run.reset();
      fill.clear();
      setTarget(null);
      setInternalTexts([]);
    }
    lastKey.current = key;
    token.current += 1;
    setRecs({ state: 'idle', value: null, error: '' });
    // run.reset and fill.clear are stable; the key is the record's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const load = useCallback(async () => {
    if (!record) return;
    token.current += 1;
    const mine = token.current;
    setRecs({ state: 'loading', value: null, error: '' });
    try {
      const pack = await read(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: 'email-compose', allowSensitive: Boolean(eff.policy?.allowHrContent) });
      if (mine === token.current) setRecs({ state: 'ready', value: recommendEmails(pack, { now: Date.now() }), error: '' });
    } catch (err) {
      if (mine === token.current) setRecs({ state: 'error', value: null, error: err?.message || 'The ticket could not be read.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.tabId, record?.table, record?.sysId, eff.policy]);

  // Read the ticket the first time this panel is shown for a record.
  useEffect(() => {
    if (active && record && recs.state === 'idle') load();
  }, [active, record, recs.state, load]);

  const draft = (type) => {
    const { feature, available } = featureState(type.featureId, eff.policy);
    if (!feature || !available) return;
    const ref = { table: record.table, sysId: record.sysId };
    fill.clear();
    setTarget(ref);
    // The pack is read for THIS record even if the page has moved on by the time "Try again" is pressed (to the email form).
    run.run(feature, {
      getPack: async () => {
        const pack = await read(page.tabId, 'pack', { ...ref, feature: contextFor(feature), allowSensitive: Boolean(eff.policy?.allowHrContent) });
        setInternalTexts(internalTextsOf(pack));
        return pack;
      },
    });
  };

  const idle = run.phase === 'idle' || run.phase === 'error';
  const showResult = run.phase === 'done' && isEmailFeature(run.active);
  const ready = recs.state === 'ready' ? recs.value : null;

  const row = (type, props = {}) => {
    const { available } = featureState(type.featureId, eff.policy);
    return (
      <TypeRow
        key={type.id}
        type={type}
        why={props.why}
        primary={props.primary}
        disabled={!aiReady || !available}
        offReason={available ? '' : 'Switched off by your organisation.'}
        onDraft={() => draft(type)}
      />
    );
  };

  return (
    <div className="ab-compose-stack">
      {!record && !showResult && (
        <p className="ab-note">Open a ticket (an incident, request, case or similar) to get email suggestions that fit it. Agent Buddy reads it with your own session.</p>
      )}

      {record && !aiReady && <p className="ab-note ab-note-warn">{aiNotReadyText(eff)}</p>}

      {record && idle && (
        <section className="ab-card" aria-label="Suggested emails">
          <div className="ab-row ab-compose-head">
            <h3 className="ab-h">Which email fits?</h3>
            <span className="ab-spacer" />
            <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={load} disabled={recs.state === 'loading'}>
              Check again
            </button>
          </div>
          {recs.state === 'loading' && <p className="ab-note" role="status">Reading the ticket with your session…</p>}
          {recs.state === 'error' && <p className="ab-note ab-note-danger" role="alert">{recs.error}</p>}
          {ready && (
            <>
              {ready.facts.length > 0 && (
                <div className="ab-tags" aria-label="What the suggestions are based on">
                  {ready.facts.map((f) => (
                    <span key={f} className="ab-tag">{f}</span>
                  ))}
                </div>
              )}
              {ready.note && <p className="ab-note ab-compose-gap">{ready.note}</p>}
              {ready.picks.length > 0 ? (
                <ul className="ab-compose-rows">{ready.picks.map((p, i) => row(p, { why: p.why, primary: i === 0 }))}</ul>
              ) : (
                <p className="ab-sub ab-compose-gap">Nothing stands out for this ticket. Pick a kind of email below if you need one.</p>
              )}
              {ready.others.length > 0 && (
                <>
                  <h4 className="ab-compose-sub">Other emails</h4>
                  <ul className="ab-compose-rows">{ready.others.map((t) => row(t))}</ul>
                </>
              )}
            </>
          )}
        </section>
      )}

      <RunPanel run={run} eff={eff} page={page} />

      {showResult && <DraftActions page={page} run={run} fill={fill} target={target || (record && { table: record.table, sysId: record.sysId })} internalTexts={internalTexts} />}
    </div>
  );
}
