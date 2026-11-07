import Summary from './Summary.jsx';
import { isOpenByDefault } from './folds.js';

/**
 * One part of the Team overview, open or folded as src/sidepanel/reports/folds.js says. An open part is drawn as it is (it has its own
 * headings); a folded one is the Team screen's usual fold: a line with its title and a chevron (<Summary>), closed until it is tapped.
 *
 * props: id (a key of SECTION_FOLDS), title (the fold's line: the part's own title), children
 */
export default function Foldable({ id, title, children }) {
  if (isOpenByDefault(id)) return <>{children}</>;
  return (
    <details className="ab-details" data-fold={id}>
      <Summary>{title}</Summary>
      {children}
    </details>
  );
}
