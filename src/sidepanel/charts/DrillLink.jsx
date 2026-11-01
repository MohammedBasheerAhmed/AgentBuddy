import React from 'react';
import { isPlainClick, NEW_TAB_HINT } from '../linkClick.js';
import { t } from '../../i18n/index.js';

/**
 * A part of a chart that opens a ServiceNow LIST (a tile, a bar, a legend row, a heat cell, a stacked row) as a real link, the same
 * way tickets are links (src/sidepanel/RecordLink.jsx): a plain click calls `onOpen` (the dashboard opens the list in the tab the
 * panel works with), Ctrl/Cmd+click, Shift+click, the middle button and the right-click menu are left to the browser, which opens
 * `href` in a new tab without an opener. Enter on the focused link is a plain click.
 *
 * `href` is built by the dashboard from the page's own origin (src/sidepanel/reports/drill.js listUrl), never from report text; an
 * address that could not be built ('') gives no link at all (the caller draws plain content instead).
 */
export default function DrillLink({ href, onOpen, className, label, children }) {
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-ab-link="list"
      title={t(NEW_TAB_HINT)}
      aria-label={label}
      onClick={(event) => {
        if (!isPlainClick(event)) return; // the browser opens a new tab
        event.preventDefault();
        if (onOpen) onOpen();
      }}
    >
      {children}
    </a>
  );
}

/** The address for an item, or '' when there is none (no function, no query, or an address that could not be built). */
export function hrefOf(hrefFor, ...args) {
  if (typeof hrefFor !== 'function') return '';
  try {
    const url = hrefFor(...args);
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : '';
  } catch {
    return '';
  }
}
