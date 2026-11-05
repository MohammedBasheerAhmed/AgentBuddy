import { Icon } from '../ui/icons.jsx';

/**
 * The quiet way from the five to everything else the record has ("More for this ticket: 8 Insights"): a row across the panel, in the
 * accent colour, that opens All tools at the right group. Never the screen's filled button. `item`: drawn as the last row of a list
 * (an <li>), else as a list of its own so it reaches the panel's edges like the rows above it.
 * props: label, onOpen(), item
 */
export default function MoreTools({ label, onOpen, item = false }) {
  const button = (
    <button type="button" className="ab-row ab-more-tools" aria-haspopup="dialog" onClick={onOpen}>
      <Icon name="grid" size={16} className="ab-more-tools-icon" />
      <span className="ab-row-main">
        <span className="ab-more-tools-text">{label}</span>
      </span>
      <Icon name="chevronRight" size={16} className="ab-more-tools-chevron ab-flip" />
    </button>
  );
  if (item) return <li className="ab-more-row">{button}</li>;
  return <div className="ab-rows ab-more-row">{button}</div>;
}
