// Settings, AI Assist: today's and this month's AI use, counted on this computer from the usage log (src/lib/aiUsage.js), and the daily
// limits: the person's own (src/providers/budget.js saveCaps) and the organisation's (`tokenBudgetPerDay`), with the one that applies.
import { useCallback, useEffect, useState } from 'react';
import { summarize, tokensUsedToday } from '../../lib/aiUsage.js';
import { readBudgetState, saveCaps } from '../../providers/budget.js';
import { dailyTokenLimit, parseLimit } from '../policyNotes.js';
import { DraftInput, FieldError, Status, describedBy } from '../fields.jsx';
import { t, tn } from '../../i18n/index.js';

/** Today's use and the daily limits, the person's own and the organisation's (`tokenBudgetPerDay`), with the one that applies. */
export function UsageSection({ eff }) {
  const [state, setState] = useState(null);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState(null);
  const load = useCallback(() => readBudgetState().then(setState).catch(() => setState({ log: [], caps: {} })), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!state) return null;

  const { today, month } = summarize(state.log);
  const own = state.caps || {};
  const limit = dailyTokenLimit({ policyBudget: eff.policy?.tokenBudgetPerDay, ownCap: own.dailyTokens, usedToday: tokensUsedToday(state.log) });

  // Not useSaveSetting: the limits are kept by the budget (saveCaps), not in the settings, and only this section reads them again.
  async function saveLimit(field, text) {
    const parsed = parseLimit(text);
    setErrors((e) => ({ ...e, [field]: parsed.ok ? '' : parsed.error }));
    if (!parsed.ok) return;
    try {
      await saveCaps({ [field]: parsed.value });
      setStatus(null);
      load();
    } catch {
      setStatus({ kind: 'danger', text: t('The browser did not save the limit. Try again.') });
    }
  }

  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  return (
    <section className="ab-section" aria-labelledby="h-usage">
      <h2 className="ab-h" id="h-usage">{t('Usage and limits')}</h2>
      <p className="ab-sub">
        {t('Counted on this computer from the usage log (no text is kept). Today: {todayCalls}, {todayTokens}. This month: {monthCalls}, {monthTokens}.', {
          todayCalls: tn(today.calls, '{n} call', '{n} calls', { n: fmt(today.calls) }),
          todayTokens: tn(today.tokens, '{n} token', '{n} tokens', { n: fmt(today.tokens) }),
          monthCalls: tn(month.calls, '{n} call', '{n} calls', { n: fmt(month.calls) }),
          monthTokens: tn(month.tokens, '{n} token', '{n} tokens', { n: fmt(month.tokens) }),
        })}
      </p>
      <p className={`ab-note ${limit.left === 0 ? 'ab-note-warn' : ''}`} id="limit-applies" role="status">{limit.text}</p>
      <div className="ab-field" style={{ marginTop: 12 }}>
        <label className="ab-label" htmlFor="cap-tokens">{t('Your own daily token limit')}</label>
        <DraftInput
          id="cap-tokens"
          className="ab-input"
          inputMode="numeric"
          value={own.dailyTokens ? String(own.dailyTokens) : ''}
          placeholder={t('No limit')}
          aria-invalid={errors.dailyTokens ? true : undefined}
          aria-describedby={describedBy('cap-tokens-hint', errors.dailyTokens && 'cap-tokens-error')}
          onSave={(text) => saveLimit('dailyTokens', text)}
        />
        <FieldError id="cap-tokens-error" text={errors.dailyTokens} />
        <span className="ab-hint" id="cap-tokens-hint">{t("Nothing is sent once today's tokens reach it. Leave empty for no limit of your own.")}</span>
      </div>
      <div className="ab-field">
        <label className="ab-label" htmlFor="cap-calls">{t('Your own daily limit of AI calls')}</label>
        <DraftInput
          id="cap-calls"
          className="ab-input"
          inputMode="numeric"
          value={own.dailyCalls ? String(own.dailyCalls) : ''}
          placeholder={t('No limit')}
          aria-invalid={errors.dailyCalls ? true : undefined}
          aria-describedby={errors.dailyCalls ? 'cap-calls-error' : undefined}
          onSave={(text) => saveLimit('dailyCalls', text)}
        />
        <FieldError id="cap-calls-error" text={errors.dailyCalls} />
      </div>
      <Status status={status} />
    </section>
  );
}
