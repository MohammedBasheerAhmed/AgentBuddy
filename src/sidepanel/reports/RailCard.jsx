import { useCallback, useState } from 'react';
import { CardFrame } from '../ui/primitives.jsx';
import { useRailSection } from '../shell/SideRail.jsx';

// A card of the My work and Team screens that the side rail lists (docs/rail-layout.md B). The card looks and folds exactly as a
// CardFrame does; it also tells the rail its name and icon, and a click in the rail opens it first if the person folded it.

/**
 * A CardFrame the side rail lists.
 *   rail           the card's entry in its screen's table ({ id, label(), icon }): the card's id (data-card) and title come from it,
 *                  so the rail says what the card says
 *   railAttention  '' | 'warn': a mark on the card's icon in the rail only (the card itself stays calm)
 *   defaultOpen    as CardFrame's
 * Every other prop goes to CardFrame.
 */
export function RailCard({ rail, railAttention = '', defaultOpen = true, children, ...card }) {
  const [open, setOpen] = useState(defaultOpen);
  const title = rail.label();
  const railRef = useRailSection({ id: rail.id, label: title, icon: rail.icon, attention: railAttention, open: () => setOpen(true) });
  return (
    <CardFrame id={rail.id} title={title} {...card} open={open} onToggle={setOpen}>
      <RailMark railRef={railRef} />
      {children}
    </CardFrame>
  );
}

// CardFrame (ui/primitives.jsx) takes no ref, and an element wrapped around the card would break the line between two cards
// (.ab-cardx + .ab-cardx): this empty, hidden mark inside the card hands the card's own element to the rail instead.
function RailMark({ railRef }) {
  const pick = useCallback((node) => railRef(node ? node.closest('.ab-cardx') : null), [railRef]);
  return <span hidden ref={pick} />;
}
