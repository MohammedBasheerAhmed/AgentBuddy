import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t, isolate } from '../../../i18n/index.js';
import { tx } from '../../../i18n/jsx.jsx';
import { BrandMark } from '../../ui/icons.jsx';
import Summary from '../Summary.jsx';
import { ticketsText } from './model.js';

// The pieces "My week" and the weekly report share (round 5, docs/round5.md): the toggle between two weeks, the numbers, the bars, the
// decisions, the note about numbers that could not be read honestly, and the page the browser saves as a PDF. Styles: src/ui/areas/reports.css
// (.ab-weekly-*). Every colour is a --ab-* token.

/** Two weeks to pick from (This week / Last week). `options`: [{ id, label }]. */
export function WeekToggle({ value, onChange, options, label }) {
  return (
    <div className="ab-seg ab-weekly-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className="ab-btn ab-btn-sm ab-seg-btn" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The numbers: a number, what it is, how it changed. A tile with a `title` says more on hover. */
export function Tiles({ tiles, compact = false }) {
  return (
    <ul className={`ab-weekly-tiles${compact ? ' ab-weekly-tiles-compact' : ''}`}>
      {tiles.map((x) => (
        <li key={x.key} className={`ab-weekly-tile${x.wide ? ' ab-weekly-tile-wide' : ''}`} title={x.title || undefined}>
          <span className="ab-weekly-value">{x.value}</span>
          <span className="ab-weekly-label">{x.label}</span>
          {x.sub && <span className="ab-weekly-sub">{x.sub}</span>}
          {x.change && <span className={`ab-weekly-change ab-weekly-${x.change.tone}`}>{x.change.text}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Closed tickets by area, as bars with their count (the count is also in words for a screen reader). */
export function Bars({ areas, heading }) {
  if (!areas.length) return null;
  const max = Math.max(...areas.map((a) => a.count));
  return (
    <section className="ab-weekly-section" aria-label={heading}>
      <h2 className="ab-weekly-h">{heading}</h2>
      <ul className="ab-weekly-bars">
        {areas.map((a) => (
          <li key={a.name} className="ab-weekly-bar">
            <span className="ab-weekly-bar-name">{a.name}</span>
            <span className="ab-weekly-bar-track" aria-hidden="true">
              <span className="ab-weekly-bar-fill" style={{ inlineSize: `${Math.max(4, Math.round((a.count / max) * 100))}%` }} />
            </span>
            <span className="ab-weekly-bar-count" aria-label={ticketsText(a.count)}>{a.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const bold = (text) => <strong>{text}</strong>;

// One decision as a sentence with its key part in bold (the same words as the plain text in model.js decisionText).
function DecisionBody({ d }) {
  if (d.id === 'cause') {
    if (d.name) return tx('Open a problem for {name}: {count} tickets, one likely cause.', { name: bold(isolate(d.name)), count: d.count });
    return tx('Open a problem: {count} tickets share one likely cause.', { count: d.count });
  }
  if (d.id === 'load') return tx('Two people hold {percent}% of the open tickets. Rebalance the work.', { percent: d.percent });
  return tx('{ratio} closes had no fix note. Ask for one at close.', { ratio: bold(t('{without} of {closed}', { without: d.without, closed: d.closed })) });
}

/** "Needs a decision": the plain items, numbered. Nothing is drawn when there are none (the caller says so). */
export function Decisions({ decisions }) {
  return (
    <ol className="ab-weekly-decisions">
      {decisions.map((d, i) => (
        <li key={d.id} className="ab-weekly-decision">
          <span className={`ab-weekly-badge ab-weekly-badge-${d.id === 'cause' ? 'bad' : 'warn'}`} aria-hidden="true">{i + 1}</span>
          <span><DecisionBody d={d.source} /></span>
        </li>
      ))}
    </ol>
  );
}

/** One quiet fold that says which numbers were left out and why. Nothing when every number was read. */
export function MissingNote({ missing }) {
  if (!missing.length) return null;
  return (
    <details className="ab-details ab-weekly-missing">
      <Summary>{t('Why are some numbers not shown?')}</Summary>
      <ul className="ab-weekly-missing-list">
        {missing.map((m) => (
          <li key={m.label}>{t('{label}: {why}', { label: m.label, why: m.why })}</li>
        ))}
      </ul>
    </details>
  );
}

// ---- The page the browser saves as a PDF ---------------------------------------------------------------------------------------------

/**
 * A place outside the panel's own tree, a child of the page's body, where the report is laid out as an A4 page. It is hidden on screen and
 * the only thing drawn while the browser prints (reports.css: body.ab-printing-weekly). The host belongs to the view that made it, so two
 * views that stay open side by side never print each other's page.
 */
export function usePdfHost() {
  const [host] = useState(() => {
    if (typeof document === 'undefined') return null;
    const el = document.createElement('div');
    el.className = 'ab-weekly-pdf-host';
    return el;
  });
  useEffect(() => {
    if (!host) return undefined;
    document.body.appendChild(host);
    return () => host.remove();
  }, [host]);
  return host;
}

/** Print this host's page: the browser's own dialog opens and "Save as PDF" is one of its choices. Nothing is sent anywhere. */
export function printHost(host) {
  if (!host || typeof window === 'undefined') return;
  const body = document.body;
  host.classList.add('ab-pdf-live');
  body.classList.add('ab-printing-weekly');
  let cleaned = false;
  const clean = () => {
    if (cleaned) return;
    cleaned = true;
    host.classList.remove('ab-pdf-live');
    body.classList.remove('ab-printing-weekly');
    window.removeEventListener('afterprint', clean);
    clearTimeout(timer);
  };
  window.addEventListener('afterprint', clean);
  // (a browser that never says "afterprint" must not leave the next print of this page showing the report)
  const timer = setTimeout(clean, 5 * 60 * 1000);
  try {
    window.print();
  } catch {
    clean();
  }
}

/** The A4 page of board E, drawn from a model (src/sidepanel/reports/weekly/model.js). `footer`: the line at the foot. */
export function PdfPage({ host, model, kicker, footer }) {
  if (!host) return null;
  return createPortal(
    <article className="ab-weekly-pdf" aria-hidden="true">
      <header className="ab-weekly-pdf-head">
        <div>
          <p className="ab-weekly-pdf-kicker">{kicker}</p>
          <h1 className="ab-weekly-pdf-title">{model.title}</h1>
          <p className="ab-weekly-pdf-period">{[model.period, model.scope].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="ab-weekly-pdf-mark"><BrandMark size={32} /></span>
      </header>
      {model.paragraph && <p className="ab-weekly-pdf-paragraph">{model.paragraph}</p>}
      <ul className="ab-weekly-pdf-tiles">
        {model.tiles.map((x) => (
          <li key={x.key} className="ab-weekly-pdf-tile">
            <span className="ab-weekly-pdf-value">{x.value}</span>
            <span className="ab-weekly-pdf-label">{x.label}</span>
            {x.sub && <span className="ab-weekly-pdf-note">{x.sub}</span>}
            {x.change && <span className="ab-weekly-pdf-note">{x.change.text}</span>}
          </li>
        ))}
      </ul>
      {(model.areas.length > 0 || model.decisions.length > 0) && (
        <div className="ab-weekly-pdf-cols">
          {model.areas.length > 0 && (
            <section>
              <h2>{model.kind === 'mine' ? t('Where your week went') : t('Closed by area')}</h2>
              <ul className="ab-weekly-bars">
                {model.areas.map((a) => (
                  <li key={a.name} className="ab-weekly-bar">
                    <span className="ab-weekly-bar-name">{a.name}</span>
                    <span className="ab-weekly-bar-track"><span className="ab-weekly-bar-fill" style={{ inlineSize: `${Math.max(4, Math.round((a.count / Math.max(...model.areas.map((x) => x.count))) * 100))}%` }} /></span>
                    <span className="ab-weekly-bar-count">{a.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {model.decisions.length > 0 && (
            <section>
              <h2>{t('Needs a decision')}</h2>
              <ol className="ab-weekly-pdf-decisions">
                {model.decisions.map((d) => (
                  <li key={d.id}>{d.text}</li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
      {model.oldest.length > 0 && (
        <section className="ab-weekly-pdf-oldest">
          <h2>{t('Oldest open tickets')}</h2>
          <table>
            <thead>
              <tr>
                <th>{t('Ticket')}</th>
                <th>{t('Short description')}</th>
                <th>{t('Age')}</th>
                <th>{t('SLA')}</th>
              </tr>
            </thead>
            <tbody>
              {model.oldest.map((o) => (
                <tr key={o.number}>
                  <td>{o.number}</td>
                  <td>{o.title}</td>
                  <td>{o.age}</td>
                  <td>{o.sla}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {model.missing.length > 0 && <p className="ab-weekly-pdf-footnote">{t('Not shown, because it could not be read honestly: {labels}.', { labels: model.missing.map((m) => m.label).join(', ') })}</p>}
      <footer className="ab-weekly-pdf-foot">
        <span>{footer}</span>
        <span>{t('Agent Buddy')}</span>
      </footer>
    </article>,
    host
  );
}

