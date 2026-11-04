import React, { useEffect, useId, useState } from 'react';
import { aiNeeds, aiNeedsText } from './aiReady.js';
import { keyStore } from '../lib/storage.js';
import { t, tm, t as tr } from '../i18n/index.js';

/**
 * Open Settings, on one of its two pages: '' (Basics) or 'ai' (AI Assist). A page is opened as its own address (options.html#ai, an
 * extension page: no permission needed); where the browser cannot, Settings opens on its first page.
 */
export function openSettings(page = '') {
  try {
    if (page && chrome.tabs?.create && chrome.runtime?.getURL) {
      Promise.resolve(chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#${page}`) })).catch(() => chrome.runtime.openOptionsPage());
      return;
    }
  } catch {
    /* fall through to the plain Settings page */
  }
  chrome.runtime.openOptionsPage();
}

export const UNLOCK_TEXT = tm('Your AI key is locked. Enter your passphrase to unlock it for this browser session.');
const CHOOSE_TEXT = tm('Your organisation requires the saved AI key to be encrypted. Choose a passphrase for it in Settings.');

/**
 * The passphrase of a locked key, entered where the key is needed (AI0.1): the same unlock as on the Settings page (keyStore.unlock,
 * src/lib/keyStore.js), so the key is kept in session memory until the browser closes. The passphrase is never stored or shown, and
 * the box is emptied after every try. A plain key the organisation wants encrypted needs a NEW passphrase chosen: that stays in
 * Settings, where its rules are explained.
 *
 * props: eff (useEffective: values.provider, refresh), primary (the filled button: the card's main action)
 */
export function KeyUnlock({ eff, primary = false }) {
  const id = `ab-unlock${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const provider = eff?.values?.provider || '';
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mustChoose, setMustChoose] = useState(false);
  useEffect(() => {
    if (!provider) return undefined;
    let live = true;
    keyStore()
      .needsEncryption(provider)
      .then((v) => live && setMustChoose(Boolean(v)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [provider]);

  async function unlock() {
    if (!pass || busy || !provider) return;
    setBusy(true);
    setError('');
    try {
      await keyStore().unlock(provider, pass);
      setPass('');
      // The panel hears the change through storage too; asking at once makes the note go without waiting for that.
      await eff?.refresh?.();
    } catch (err) {
      setPass('');
      setError(err?.message || t('The key could not be unlocked.'));
    } finally {
      setBusy(false);
    }
  }

  if (mustChoose) {
    return (
      <div className="ab-note ab-note-warn ab-keynote">
        <p className="ab-keynote-text">{tr(CHOOSE_TEXT)}</p>
        <button type="button" className="ab-btn ab-btn-sm" onClick={() => openSettings('ai')}>
          {t('Open Settings')}
        </button>
      </div>
    );
  }
  return (
    <div className="ab-note ab-note-warn ab-keynote ab-unlock">
      <label className="ab-keynote-text" htmlFor={id}>
        {tr(UNLOCK_TEXT)}
      </label>
      <div className="ab-unlock-row">
        <input
          id={id}
          type="password"
          className="ab-input"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              unlock();
            }
          }}
          autoComplete="off"
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? 'true' : undefined}
          disabled={busy}
        />
        <button type="button" onClick={unlock} className={`ab-btn ab-btn-sm${primary ? ' ab-btn-primary' : ''}`} disabled={!pass || busy}>
          {busy ? t('Unlocking…') : t('Unlock')}
        </button>
      </div>
      {error && (
        <p className="ab-unlock-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={() => openSettings('ai')}>
        {t('Forgot it? Enter the key again in Settings')}
      </button>
    </div>
  );
}

/**
 * "Add an AI key in Settings to use ..." with the way there: one button that opens Settings. A note that only says what is wrong
 * leaves the person to find Settings themselves; this is the next step, one click away. A locked key is unlocked right here
 * (KeyUnlock). Renders nothing when the AI can be used.
 *
 * props: eff, what (finishes "...to use <what>."), also (a second sentence: what works without a key)
 */
export default function AiKeyNote({ eff, what = 'these actions', also = '' }) {
  const needs = aiNeeds(eff);
  if (needs === 'unlock') return <KeyUnlock eff={eff} />;
  const text = aiNeedsText(eff, what);
  if (!text) return null;
  return (
    <div className="ab-note ab-note-warn ab-keynote">
      <p className="ab-keynote-text">
        {text}
        {also ? ` ${also}` : ''}
      </p>
      {/* The organisation's policy is not something Settings can change: no button that leads nowhere. */}
      {needs !== 'policy' && (
        <button type="button" className="ab-btn ab-btn-sm" onClick={() => openSettings('ai')}>
          {t('Open Settings')}
        </button>
      )}
    </div>
  );
}
