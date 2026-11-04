import { useEffect, useRef, useState } from 'react';
import { read, plainError } from '../ask.js';
import ReviewHints from '../ReviewHints.jsx';
import { ShowMore } from '../ui/primitives.jsx';
import { FORM_FIELDS, MAX_FORM_TEXT } from '../../compose/formFields.js';
import { checkTypedText, internalTextsOf } from '../../safeSend/review.js';
import { isolate, t, tn, t as tr } from '../../i18n/index.js';

// N22 "Check my comment": the safe-to-send check on what the agent TYPED into the form, before they press Post or Save. The same
// review an insert gets (src/safeSend/review.js): personal data and secrets, another person's name or email, markup, links, words
// copied from an internal work note, and internal-only wording (the built-in list plus the organisation's `internalPhrases`).
//
// The text is read from the open form (the page bridge's form read, classic forms only) or pasted; the record's people and notes
// are read so the record's own people are not flagged and copied work-note words are. Nothing leaves the browser and nothing is kept.

/** The fields worth checking: the ones the customer can read that hold more than one line. */
export const CHECK_FIELDS = FORM_FIELDS.filter((f) => f.customerVisible && !f.singleLine);
export const SEND_CHECK_FEATURE = 'send-check';

const buttonLabel = (field) => (field.name === 'comments' ? t('Check my comment') : t('Check my {field}', { field: tr(field.label).toLowerCase() }));

/** One line for the card's title row, and how much attention it needs. */
export function checkSummary(state) {
  const result = state?.result;
  if (!result) return { text: '', attention: '' };
  if (result.status === 'clean') return { text: t('Nothing found'), attention: '' };
  if (result.status === 'findings') {
    const n = result.serious.length;
    if (n) return { text: tn(n, '{n} to check before sending', '{n} to check before sending'), attention: 'warn' };
    return { text: tn(result.hints.length, '{n} worth a look', '{n} worth a look'), attention: '' };
  }
  return { text: '', attention: '' };
}

export default function SafeSendCheck({ page, eff, active, onSummary = () => {} }) {
  const [fieldName, setFieldName] = useState('comments');
  const [state, setState] = useState(null); // { phase: 'reading' | 'done' | 'note', result?, note?, from: 'form' | 'pasted' }
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const token = useRef(0);
  const field = CHECK_FIELDS.find((f) => f.name === fieldName) || CHECK_FIELDS[0];
  const record = page?.record;
  const key = record ? `${record.table}:${record.sysId}` : '';

  // Another record: a result about the last one's form is not about this one.
  useEffect(() => {
    token.current += 1;
    setState(null);
  }, [key]);

  useEffect(() => {
    onSummary(checkSummary(state));
    // onSummary is the parent's setter; only the result matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // The record's people and work notes, for the check. Best effort: without them the check still runs on the text.
  async function recordContext() {
    if (!record) return { people: [], internalTexts: [] };
    try {
      const pack = await read(page.tabId, 'pack', { table: record.table, sysId: record.sysId, feature: SEND_CHECK_FEATURE, allowSensitive: Boolean(eff.policy?.allowHrContent) });
      return { people: Array.isArray(pack?.people) ? pack.people : [], internalTexts: internalTextsOf(pack) };
    } catch {
      return { people: [], internalTexts: [], partial: true };
    }
  }

  const check = (text, context, from) => {
    const result = checkTypedText(field.name, text, { people: context.people, internalTexts: context.internalTexts, internalPhrases: eff.policy?.internalPhrases || [] });
    return { phase: 'done', result, from, partial: Boolean(context.partial) };
  };

  async function checkForm() {
    token.current += 1;
    const mine = token.current;
    setState({ phase: 'reading', from: 'form' });
    const expect = record ? { table: record.table, sysId: record.sysId } : undefined;
    try {
      const [answer, context] = await Promise.all([read(page.tabId, 'formValues', { names: [field.name], ...(expect ? { expect } : {}) }), recordContext()]);
      if (mine !== token.current) return;
      if (answer?.wrongForm) {
        setState({
          phase: 'note',
          note: record?.number
            ? t('The form on the page is not {number}. Open that ticket again, or paste the text below.', { number: isolate(record.number) })
            : t('The form on the page is not the ticket open here. Open that ticket again, or paste the text below.'),
        });
        setPasteOpen(true);
      } else if (!answer?.available) {
        setState({ phase: 'note', note: t('Agent Buddy cannot read the form on this page (Workspace and portal pages keep it out of reach). Paste the text below instead.') });
        setPasteOpen(true);
      } else setState(check(String(answer.values?.[field.name] ?? ''), context, 'form'));
    } catch (err) {
      if (mine === token.current) setState({ phase: 'note', note: plainError(err, t('The form could not be read. Paste the text below instead.')) });
    }
  }

  async function checkPasted() {
    token.current += 1;
    const mine = token.current;
    setState({ phase: 'reading', from: 'pasted' });
    const context = await recordContext();
    if (mine === token.current) setState(check(pasted, context, 'pasted'));
  }

  const result = state?.phase === 'done' ? state.result : null;
  const where = state?.from === 'pasted' ? t('The pasted text') : t('Your {field}', { field: tr(field.label).toLowerCase() });

  return (
    <div className="ab-write-check">
      <div className="ab-row ab-write-check-row">
        <label className="ab-sub" htmlFor="ab-check-field">{t('Field')}</label>
        <select
          id="ab-check-field"
          className="ab-select ab-compose-select"
          value={field.name}
          onChange={(e) => {
            // A check still on its way is about the field it read: its answer must not show under the new field's name.
            token.current += 1;
            setFieldName(e.target.value);
            setState(null);
          }}
        >
          {CHECK_FIELDS.map((f) => (
            <option key={f.name} value={f.name}>{tr(f.label)}</option>
          ))}
        </select>
        <button type="button" className="ab-btn ab-btn-primary ab-btn-sm" disabled={!active || state?.phase === 'reading'} onClick={checkForm}>
          {buttonLabel(field)}
        </button>
      </div>
      <p className="ab-hint">{t('Checks what you typed for personal data, passwords and internal wording before the customer sees it.')}</p>

      {state?.phase === 'reading' && <p className="ab-sub" role="status">{state.from === 'form' ? t('Reading the form…') : t('Checking…')}</p>}
      {state?.phase === 'note' && <p className="ab-note ab-note-warn" role="status">{state.note}</p>}

      {result?.status === 'empty' && (
        <p className="ab-note" role="status">
          {state.from === 'pasted' ? t('There is nothing to check yet.') : t('The {field} field is empty. Type your message in the form first, or paste it below.', { field: tr(field.label).toLowerCase() })}
        </p>
      )}
      {result?.status === 'clean' && (
        <p className="ab-note ab-note-ok" role="status">
          {t('{where}: nothing to worry about found. This check cannot catch everything, so give it a last read.', { where })}
        </p>
      )}
      {result?.status === 'findings' && (
        <div className={`ab-note ${result.serious.length ? 'ab-note-warn' : ''}`} role="status">
          {result.serious.length > 0 && (
            <>
              <strong>{t('{where}: check before sending.', { where })}</strong>
              <ShowMore
                items={result.serious}
                className="ab-compose-list ab-write-findings"
                render={(f, i) => (
                  <p key={i} className="ab-write-finding">
                    {f.advice} <span className="ab-mono">{f.excerpt}</span>
                  </p>
                )}
              />
            </>
          )}
          {result.serious.length === 0 && <strong>{t('{where}: nothing serious found.', { where })}</strong>}
          <ReviewHints hints={result.hints} />
        </div>
      )}
      {state?.partial && <p className="ab-hint">{t("The ticket's people and notes could not be read, so names and copied notes were not compared.")}</p>}

      {pasteOpen ? (
        <div className="ab-field">
          <label className="ab-label" htmlFor="ab-check-paste">{t('Text to check')}</label>
          <textarea id="ab-check-paste" className="ab-textarea ab-compose-text" maxLength={MAX_FORM_TEXT} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={t('Paste the message you are about to send')} />
          <div className="ab-row">
            <button type="button" className="ab-btn ab-btn-sm" disabled={!pasted.trim() || state?.phase === 'reading'} onClick={checkPasted}>{t('Check this text')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm ab-write-paste" onClick={() => setPasteOpen(true)}>{t('Paste the text instead')}</button>
      )}
    </div>
  );
}
