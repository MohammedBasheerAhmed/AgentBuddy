import { recordUrl, openInNewTab, openWork } from './openRecord.js';
import { staysInOwnUi } from '../lib/snLinks.js';
import { isPlainClick, NEW_TAB_HINT, OWN_TAB_HINT } from './linkClick.js';
import { t } from '../i18n/index.js';

/**
 * A record (or any address on the instance) as a real link. A plain click opens it in a NEW tab next to the one the panel is
 * attached to, so the ticket being worked on (and anything typed on it and not saved) is never replaced: every "look at this" link
 * (a related ticket, an article, a duplicate, a card) is this. `sameTab` is for the few "go work on this" links (a list, a worklist
 * row): the plain click then opens it in the tab the panel is attached to, still in a new tab when that would replace a Workspace or
 * portal tab with a classic page. Ctrl/Cmd+click, middle-click and the right-click menu use the browser's new-tab behaviour
 * (target="_blank", no opener). The address is always built from the page's own origin (src/lib/snLinks.js), never from ticket text.
 *
 * props: page, item ({ table, sysId, number }; an article is opened by its number) or url (a ready address), intent? ('author': an
 *   article in its authoring form, the Duplicates screen), onOpen? (replaces the plain-click action), sameTab?, newTab? (the default,
 *   kept so the callers that say it still read right), className, title?, children
 */
export default function RecordLink({ page, item, url: given, intent, onOpen, sameTab = false, newTab = true, className, title, children }) {
  const url = given ?? recordUrl(page, item || {}, { intent });
  // An address that could not be built safely: show the text, offer nothing to click.
  if (!url) return <span className={className}>{children}</span>;
  const inNewTab = newTab && !sameTab;
  const sameTabOpen = !inNewTab && staysInOwnUi(page, url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-ab-link="record"
      className={className}
      title={title ?? t(sameTabOpen ? NEW_TAB_HINT : OWN_TAB_HINT)}
      onClick={(event) => {
        if (!isPlainClick(event)) return; // the browser opens a new tab
        event.preventDefault();
        if (onOpen) onOpen();
        else if (inNewTab) openInNewTab(page, url);
        else openWork(page, url);
      }}
    >
      {children}
    </a>
  );
}
