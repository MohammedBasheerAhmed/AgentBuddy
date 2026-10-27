// What could not be read, in plain words. Shown under results so a missing list is never mistaken for "nothing there".
const SHOWN = new Set(['denied', 'error', 'empty-or-hidden']);

export default function Notes({ access }) {
  const notes = (access || []).filter((a) => SHOWN.has(a.status));
  if (!notes.length) return null;
  return (
    <p className="ab-hint ab-kb-notes">
      {notes.map((a) => (a.note ? `${a.source}: ${a.note}` : `${a.source}: not available to you.`)).join(' ')}
    </p>
  );
}
