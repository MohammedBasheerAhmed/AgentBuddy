import { Icon } from '../ui/icons.jsx';

/**
 * The <summary> of a fold in the Team screen (notes about the numbers, By table, Who holds the risk, Tables...): its words, then a
 * chevron that points down and turns up while the fold is open (ui.css: details[open] > summary .ab-chevron). The browser's own
 * triangle is hidden (reports.css), so every fold of the panel opens the same way.
 */
export default function Summary({ children }) {
  return (
    <summary className="ab-summary">
      <span>{children}</span>
      <Icon name="chevronDown" size={14} className="ab-chevron" />
    </summary>
  );
}
