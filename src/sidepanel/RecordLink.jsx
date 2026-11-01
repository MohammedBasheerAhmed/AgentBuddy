import { recordUrl, openUrl, openInNewTab } from './openRecord.js';
import { isPlainClick, NEW_TAB_HINT, OWN_TAB_HINT } from './linkClick.js';
import { t } from '../i18n/index.js';

/**
 * A record (or any address on the instance) as a real link. A plain click opens it in the tab the panel is attached to, as a
 * button used to, or with `newTab` in a new tab next to it (the Ticket screen: the ticket being worked on is never replaced).
 * Ctrl/Cmd+click, middle-click and the right-click menu use the browser's new-tab behaviour (target="_blank", no opener). The
 * address is always built from the page's own origin (openRecord.js), never from ticket text.
 *
 * props: page, item ({ table, sysId }) or url (a ready address), onOpen? (replaces the plain-click action), newTab?, className,
 *   title?, children
 */
export default function RecordLink({ page, item, url: given, onOpen, newTab = false, className, title, children }) {
  const url = given ?? recordUrl(page, item || {});
  // An address that could not be built safely: show the text, offer nothing to click.
  if (!url) return <span className={className}>{children}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-ab-link="record"
      className={className}
      title={title ?? t(newTab ? OWN_TAB_HINT : NEW_TAB_HINT)}
      onClick={(event) => {
        if (!isPlainClick(event)) return; // the browser opens a new tab
        event.preventDefault();
        if (onOpen) onOpen();
        else if (newTab) openInNewTab(page, url);
        else openUrl(page, url);
      }}
    >
      {children}
    </a>
  );
}
