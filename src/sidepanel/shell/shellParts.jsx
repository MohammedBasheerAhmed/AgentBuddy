import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/icons.jsx';
import { PROVIDERS, endpointHost, providerName, resolveProviderConfig } from '../../providers/config.js';
import { modelChoices } from '../../lib/modelChoices.js';
import { saveSettings } from '../../lib/storage.js';
import { activeProfiles, aiOffByPolicy, confirmPatch, missingProfileFor } from '../../profiles/profiles.js';
import { t, isolate } from '../../i18n/index.js';

// Pieces of the panel frame that more than one screen uses (owner: the lead, docs/round3.md).

/** Where AI Assist sends text, in words: "DeepSeek (api.deepseek.com)", "the endpoint ai.corp.example". '' when unknown. */
export function destinationOf(eff) {
  if (!eff?.values) return '';
  const config = resolveProviderConfig(eff.values, eff.apiKey);
  const name = providerName(config);
  let host;
  try {
    const def = PROVIDERS[config.provider] || {};
    const url = config.baseUrl || def.baseUrl || def.apiUrl || '';
    host = url ? new URL(url).host : '';
  } catch {
    host = '';
  }
  const endpoint = endpointHost(config);
  if (endpoint) return t('the AI service at {host}', { host: isolate(endpoint) });
  return host ? `${name} (${isolate(host)})` : name;
}

/**
 * The half (Insights or AI Assist) a screen shows: remembered per screen in settings.halves, Insights when the organisation switched
 * AI off. Returns [half, setHalf]; setHalf shows the half at once and saves the choice in the background.
 */
export function useHalf(screen, eff) {
  const saved = eff?.values?.halves?.[screen] === 'assist' ? 'assist' : 'insights';
  const [half, setHalfState] = useState(saved);
  // A choice made elsewhere (the command palette) arrives as a changed setting: the half follows it. The first look is skipped (state starts from it).
  const seen = useRef(saved);
  useEffect(() => {
    if (seen.current === saved) return;
    seen.current = saved;
    setHalfState(saved);
  }, [saved]);
  const setHalf = (next) => {
    if (next !== 'insights' && next !== 'assist') return;
    setHalfState(next);
    saveSettings({ halves: { ...(eff?.values?.halves || {}), [screen]: next } }).catch(() => {});
  };
  return [aiOffByPolicy(eff) ? 'insights' : half, setHalf];
}

/** The AI model in use, and a way to switch it without opening Settings (only where it can change). */
export function ModelSwitch({ eff }) {
  const def = PROVIDERS[eff.values?.provider];
  if (!def) return null;
  const current = eff.values.models?.[eff.values.provider] || def.defaultModel;
  const choices = modelChoices({ def, current, loaded: eff.values.modelLists?.[eff.values.provider], allowed: eff.policy?.allowedModels });
  if (!current && !choices.length) return null;
  if (eff.locked?.model || choices.length < 2) return <span className="ab-tag ab-mono ab-model" title={t('The AI model in use. Change it in Settings.')}>{current}</span>;
  return (
    <select
      className="ab-select ab-select-sm ab-model"
      aria-label={t('AI model')}
      title={t('The AI model in use. Pick another to switch.')}
      value={current}
      onChange={(e) => saveSettings({ models: { ...eff.values.models, [eff.values.provider]: e.target.value } }).catch(() => {})}
    >
      {choices.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
    </select>
  );
}

/** AI Assist when the person chose "Skip AI for now": one line and the way back. */
export function AiSkippedNote() {
  return (
    <div className="ab-note ab-keynote">
      <p className="ab-keynote-text">{t('AI Assist is off on this computer. Insights works without it.')}</p>
      <button type="button" className="ab-btn ab-btn-sm" onClick={() => saveSettings({ aiSkipped: false }).catch(() => {})}>
        {t('Turn AI Assist on')}
      </button>
    </div>
  );
}

// Kinds of record whose hint was dismissed with "Not now" in this panel session (not saved: it comes back tomorrow).
const dismissed = new Set();

/** "This is a customer service case. Show customer service tools?" on a ticket outside the person's work profiles. */
export function ProfileHint({ kind, eff }) {
  const [, redraw] = useState(0);
  const hint = missingProfileFor(kind, eff);
  if (!hint || dismissed.has(kind)) return null;
  const add = () => saveSettings(confirmPatch([...new Set([...activeProfiles(eff), hint.profile.id])], eff)).catch(() => {});
  return (
    <div className="ab-profilehint" role="note">
      <p>{hint.text}</p>
      <button type="button" className="ab-btn ab-btn-sm" onClick={add}>{t('Show them')}</button>
      <button
        type="button"
        className="ab-btn ab-btn-quiet ab-btn-sm"
        onClick={() => {
          dismissed.add(kind);
          redraw((n) => n + 1);
        }}
      >
        {t('Not now')}
      </button>
    </div>
  );
}

/** The settings mark in the header: a gear that opens the settings page. */
export function SettingsButton() {
  return (
    <button type="button" className="ab-iconbtn" aria-label={t('Settings')} title={t('Settings')} onClick={() => chrome.runtime.openOptionsPage()}>
      <Icon name="gear" size={18} />
    </button>
  );
}
