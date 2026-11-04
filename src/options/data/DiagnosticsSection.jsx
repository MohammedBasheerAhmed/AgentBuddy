// Settings, Basics: "Copy diagnostics" for support. What goes in is decided by ../diagnostics.js (pure, tested); this gathers the
// key's place, the sites and the activity log, copies the text and shows it.
import { useState } from 'react';
import { keyStore, readAudit } from '../../lib/storage.js';
import { MSG } from '../../lib/messages.js';
import { diagnosticsText } from '../diagnostics.js';
import { SectionHead, Status } from '../fields.jsx';
import { Icon } from '../../sidepanel/ui/icons.jsx';
import { t } from '../../i18n/index.js';

/**
 * "Copy diagnostics": versions, settings without any key, the policy in short, the sites, and the last problems of the activity log,
 * as plain text for support (src/options/diagnostics.js decides what goes in). Shown before it is copied.
 */
export function DiagnosticsSection({ eff }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState(null);

  async function build() {
    const [keyMode, listed, audit] = await Promise.all([
      eff.values.providedApiKey ? Promise.resolve('none') : keyStore().mode(eff.values.provider).catch(() => 'none'),
      Promise.resolve()
        .then(() => chrome.runtime.sendMessage({ type: MSG.LIST_INSTANCES }))
        .catch(() => null),
      readAudit().catch(() => []),
    ]);
    let manifest;
    try {
      manifest = chrome.runtime.getManifest();
    } catch {
      manifest = {};
    }
    return diagnosticsText({ manifest, userAgent: navigator.userAgent, eff, keyMode, instances: Array.isArray(listed?.instances) ? listed.instances : eff.values.instances || [], audit });
  }

  async function copy() {
    setStatus(null);
    try {
      const made = await build();
      setText(made);
      await navigator.clipboard.writeText(made);
      setStatus({ kind: 'ok', text: t('Copied. Paste it into your message to support. It holds no key and no ticket content.') });
    } catch {
      setStatus({ kind: 'warn', text: t('The browser did not let Agent Buddy copy it. Select the text below and copy it yourself.') });
    }
  }

  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-diagnostics">
      <SectionHead id="h-diagnostics" title={t('Help from support')}>
        {t("Copies the versions, your settings without any key, your organisation's policy in short and the last problems. No ticket content.")}
      </SectionHead>
      <div className="ab-set-actions">
        <button type="button" className="ab-btn" onClick={copy}>{t('Copy diagnostics')}</button>
      </div>
      <Status status={status} />
      {text && (
        <details className="ab-more ab-set-fold">
          <summary>{t('What was copied')}<Icon name="chevronDown" className="ab-chevron" /></summary>
          <pre className="ab-diagnostics" tabIndex={0}>{text}</pre>
        </details>
      )}
    </section>
  );
}
