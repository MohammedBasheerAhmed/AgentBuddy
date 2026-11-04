import { describeTile, formatNumber, toneClass } from './geometry.js';
import DrillLink from './DrillLink.jsx';
import { t } from '../../i18n/index.js';

const ARROW = { up: '▲', down: '▼', flat: '▬' };
const wordOf = (direction) => ({ up: t('Up'), down: t('Down'), flat: t('No change') })[direction];

// A number that is a problem carries a small status dot by its label (no coloured edges: TRACKER.md 2.4, calm). The dot is never
// the only cue: the label and the hint say what the number is.
const DOT = { bad: 'danger', warn: 'warn' };

/**
 * One headline number: a small label, the number large, a short hint. HTML, not SVG.
 *
 *   value        number or text
 *   tone         'bad' | 'warn' draw a status dot by the label (a problem); any other tone draws none
 *   unavailable  the person cannot read this data: shows "Not available to you", never a 0
 *   loading      a calm placeholder while the read is running
 *   delta        { text, direction: 'up'|'down'|'flat', good: true|false|null }: an arrow and a word as well as a colour
 *   onOpen       makes the whole tile a button (drill down); its name is "label: value, hint"
 *   href         with onOpen: the address of the list the tile opens. The tile is then a real link (a click opens the list in the
 *                ServiceNow tab through onOpen, Ctrl/middle-click or the right-click menu use a new tab). Without it, a button
 *                (for a tile that opens a choice rather than one list).
 *   expanded     for such a button: whether the choice it opens is showing (aria-expanded)
 */
export default function Tile({ label, value, hint, delta, tone = 'neutral', onOpen, href = '', expanded, unavailable = false, loading = false }) {
  const busy = Boolean(loading) && !unavailable;
  const missing = Boolean(unavailable);
  const shown = typeof value === 'number' ? formatNumber(value) : String(value ?? '');
  const dir = ARROW[delta?.direction] ? delta.direction : 'flat';
  const dot = !missing && !busy ? DOT[tone] : '';

  const body = (
    <>
      <span className="ab-tile-label">
        {dot ? <span className={`ab-dot ab-dot-${dot} ab-tile-dot`} aria-hidden="true" /> : null}
        {label}
      </span>
      {missing ? (
        <span className="ab-tile-unavailable">{t('Not available to you')}</span>
      ) : busy ? (
        <span className="ab-tile-value ab-tile-loading">
          <span aria-hidden="true">…</span>
          <span className="ab-chart-sr">{t('Loading')}</span>
        </span>
      ) : (
        <span className="ab-tile-value">{shown}</span>
      )}
      {hint && !missing ? <span className="ab-tile-hint">{hint}</span> : null}
      {delta?.text && !missing && !busy ? (
        <span className={`ab-tile-delta${delta.good === true ? ' ab-tile-delta-good' : delta.good === false ? ' ab-tile-delta-bad' : ''}`}>
          <span aria-hidden="true">{ARROW[dir]}</span>
          <span className="ab-chart-sr">{wordOf(dir)} </span>
          {delta.text}
          {delta.good === true ? ` (${t('better')})` : delta.good === false ? ` (${t('worse')})` : ''}
        </span>
      ) : null}
    </>
  );

  const className = `ab-tile ${toneClass(missing ? 'neutral' : tone)}${missing ? ' ab-tile-missing' : ''}`;
  if (onOpen && href && !missing && !busy) {
    return (
      <DrillLink className={`${className} ab-tile-button ab-tile-link`} href={href} onOpen={onOpen} label={t('{description} Open the list.', { description: describeTile({ label, value: shown, hint, delta }) })}>
        {body}
      </DrillLink>
    );
  }
  if (onOpen && !missing && !busy) {
    return (
      <button type="button" className={`${className} ab-tile-button`} aria-label={describeTile({ label, value: shown, hint, delta })} aria-expanded={typeof expanded === 'boolean' ? expanded : undefined} onClick={onOpen}>
        {body}
      </button>
    );
  }
  // Not a button: the text is read in order (label, value, hint, change), which is its accessible name.
  return <div className={className}>{body}</div>;
}
