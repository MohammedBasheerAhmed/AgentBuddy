import { PATHS } from './iconPaths.js';

// One small icon set for the whole panel (stroke icons on a 24 px grid, drawn in the text colour so they follow light and dark and
// the accent of whatever holds them). Always decorative: the words next to an icon, or the aria-label of its button, are the name.
// The drawing data is in iconPaths.js (shared with the bar on the ServiceNow page); to add an icon, add one entry there.

/** An icon by name. size in px (the grid is 24, drawn at 16 by default). Unknown names draw nothing. 'spark' is the AI mark. */
export function Icon({ name, size = 16, className = '', strokeWidth = 1.8 }) {
  const d = PATHS[name === 'spark' ? 'sparkle' : name];
  if (!d) return null;
  return (
    <svg className={`ab-icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}

export { featureIcon, screenIcon } from './featureIcons.js';

/** The mark of the product: the tile of the extension's own icon (a speech bubble with a tick), drawn in the accent colour. */
export function BrandMark({ size = 26 }) {
  return (
    <svg className="ab-brandmark" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" className="ab-brandmark-tile" />
      <path d="M8 8.5h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H15l-4.6 3.6a.6.6 0 0 1-1-.5V21.5H8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" className="ab-brandmark-bubble" />
      <path d="M11.4 15.2l3.2 3.1 6-6.1" className="ab-brandmark-tick" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
