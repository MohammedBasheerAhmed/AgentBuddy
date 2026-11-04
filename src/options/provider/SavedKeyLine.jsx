// The line under the key box: what is saved for this provider, so a person can see that the key was really taken. A short preview and
// its length, and on request the whole key (ProviderSection hides it again after a few seconds). Never offered for a key the
// organisation supplies (that branch has no key box).
import { keyPreview } from '../../lib/keyStore.js';
import { t, tn, t as tr } from '../../i18n/index.js';
import { tx } from '../../i18n/jsx.jsx';
import { KEY_MODE_LABEL, KEY_WHERE } from './keyPlaces.js';

export function SavedKeyLine({ def, keyMode, wanted, apiKey, shown, onToggle }) {
  if (keyMode === 'none') return <span className="ab-hint" id="key-saved">{t('No key is saved for {label}.', { label: def.label })}</span>;
  if (!apiKey) return <span className="ab-hint" id="key-saved">{t('A key is saved but locked. Unlock it above with your passphrase.')}</span>;
  const { preview, length } = keyPreview(apiKey);
  return (
    <span className="ab-hint" id="key-saved">
      {tx('Saved: {preview} ({chars}), kept in {where}.', { preview: preview ? <code className="ab-mono">{preview}</code> : '', chars: tn(length, '{n} character', '{n} characters'), where: tr(KEY_WHERE[keyMode] || KEY_WHERE.local) })}
      {wanted && keyMode !== wanted ? ` ${t('That is not where you chose to keep it ("{label}"): see below.', { label: tr(KEY_MODE_LABEL[wanted]) })}` : ''}{' '}
      <button type="button" className="ab-btn ab-btn-quiet ab-btn-sm" onClick={onToggle} aria-pressed={shown} aria-controls="key-full">{shown ? t('Hide saved key') : t('Show saved key')}</button>
      {shown && <code className="ab-mono" id="key-full" style={{ display: 'block', marginTop: 4, wordBreak: 'break-all' }}>{apiKey}</code>}
    </span>
  );
}
