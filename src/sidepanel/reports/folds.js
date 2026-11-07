// Which parts of the Team overview are open when it is shown, and which are folded under their own title. The Team screen was called
// cluttered (about fifteen sections, all open): a lead should see what needs them first and open the rest on purpose. ONE table says
// it, and a part changes with one word here (the views draw every part through <Foldable id>, src/sidepanel/reports/Foldable.jsx).
// tests/lead-folds.test.js pins the open set.
//
//   'open'  drawn as it is, no fold
//   'fold'  one line with the part's own title and a chevron; opened by a tap (the same fold as "By ticket type", "Who holds the risk")
//
// A part that is not in the table (a section added later) is folded: new things start out of the way.
export const SECTION_FOLDS = Object.freeze({
  // What a lead asks first: what needs me now, where the queue stands, what is about to break, who has what, what waits for my
  // approval, and the hand-over.
  attention: 'open',
  overview: 'open',
  closest: 'open',
  workload: 'open',
  approvals: 'open',
  handover: 'open',
  // The rest, folded under the title it already has.
  'overview-by-type': 'fold',
  'sla-who': 'fold',
  ageing: 'fold',
  reassigned: 'fold',
  quality: 'fold',
  'fulfilment-state': 'fold',
  'fulfilment-other': 'fold',
  'fulfilment-oldest': 'fold',
  'handover-waiting': 'fold',
});

/** Is this part open when the screen is first shown? */
export const isOpenByDefault = (id) => SECTION_FOLDS[id] === 'open';

/** The ids of the parts that are open by default, in the table's order. */
export const OPEN_BY_DEFAULT = Object.freeze(Object.keys(SECTION_FOLDS).filter(isOpenByDefault));
