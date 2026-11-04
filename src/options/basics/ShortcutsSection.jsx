// Settings, Basics: the keyboard shortcuts as the browser has them now (the person may have changed them), and the way to the browser's
// own page to change them. An extension cannot set its shortcuts itself.
import { useEffect, useState } from 'react';
import { SectionHead } from '../fields.jsx';
import { t, tm } from '../../i18n/index.js';

// The keyboard shortcuts of the manifest (src/background/commands.js): the name each one is shown by.
const SHORTCUT_NAMES = { 'open-panel': tm('Open Agent Buddy'), summarise: tm('Summarise this ticket'), reply: tm('Draft a reply') };

/** The keyboard shortcuts as the browser has them now (the person may have changed them), and the way to the browser's own page to change them. */
export function ShortcutsSection() {
  const [commands, setCommands] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all = await chrome.commands.getAll();
        if (alive) setCommands(all.filter((c) => SHORTCUT_NAMES[c.name]));
      } catch {
        if (alive) setCommands([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const edge = typeof navigator !== 'undefined' && /\bEdg\//.test(navigator.userAgent);
  const openBrowserPage = () => {
    try {
      chrome.tabs.create({ url: edge ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts' });
    } catch {
      /* the browser did not open it: the address is in the hint */
    }
  };
  return (
    <section className="ab-section ab-set-section" aria-labelledby="h-shortcuts">
      <SectionHead id="h-shortcuts" title={t('Keyboard shortcuts')}>
        {t('Summarise and Draft a reply open the panel and start on the ticket that is open. You still see what will be sent before anything is.')}
      </SectionHead>
      {commands && commands.length > 0 && (
        <ul className="ab-set-list">
          {commands.map((c) => (
            <li key={c.name} className="ab-set-item">
              <span className="ab-set-item-main">{t(SHORTCUT_NAMES[c.name])}</span>{' '}
              {c.shortcut ? <kbd data-ltr className="ab-mono ab-set-kbd">{c.shortcut}</kbd> : <span className="ab-hint">{t('Not set')}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="ab-set-actions">
        <button type="button" className="ab-btn ab-btn-sm" onClick={openBrowserPage} aria-describedby="shortcuts-hint">{t('Change the shortcuts in the browser')}</button>
        <span className="ab-hint" id="shortcuts-hint">{t('The browser keeps your own choice when Agent Buddy updates.')}</span>
      </div>
    </section>
  );
}
