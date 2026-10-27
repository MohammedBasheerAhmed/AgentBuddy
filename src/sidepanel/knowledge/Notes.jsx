import { describeAccess } from '../plainAccess.js';

// What could not be read, in plain words ("Article links: You cannot read article links."), never a table name. Shown under results
// so a missing list is never mistaken for "nothing there". The wording lives in src/sidepanel/plainAccess.js.
export default function Notes({ access }) {
  const lines = describeAccess(access);
  if (!lines.length) return null;
  return <p className="ab-hint ab-kb-notes">{lines.join(' ')}</p>;
}
