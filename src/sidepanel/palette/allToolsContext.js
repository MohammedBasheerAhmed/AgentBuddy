// How any part of the panel opens All tools (the command palette, grown into the place where everything beyond the five lives:
// docs/focus-layout.md). The shell (App.jsx) provides the opener; a screen calls it, for example from "More for this ticket".
//
//   const openAllTools = useAllTools();
//   openAllTools('ticket-insights')   // or 'ticket-assist', or nothing: All tools from the top
//
// The section id only says where to start (that group first); nothing else depends on it.
import { createContext, useContext } from 'react';

export const AllToolsContext = createContext(() => {});

/** The opener of All tools: `(section?: string) => void`. Outside the shell it does nothing. */
export const useAllTools = () => useContext(AllToolsContext);

// What the Ticket screen knows about the record on show ({ key: 'table:sysId', header, offered }), so All tools offers exactly what that
// record offers: a card's or an action's `when` rule may need the state or the priority (the major incident updates are offered only
// on a priority 1 incident), and an action may need a read first (the checklist from the instructions is offered only when the written
// instructions have no steps); a list built without them would get it wrong. `offered`: the ids of the AI actions the Ticket screen
// offers (its plan), or null when it has not worked them out. Panel memory only, one record; nothing is stored.
let shared = { key: '', header: null, offered: null };

/** The Ticket screen hands over the header of the record it shows (null while it is still being read) and the actions it offers. */
export function shareTicketHeader(key, header, offered = null) {
  shared = { key: String(key || ''), header: header || null, offered: Array.isArray(offered) ? [...offered] : null };
}

/** The header the Ticket screen read for this record ('table:sysId'), or null when it has not read one (yet). */
export function sharedTicketHeader(key) {
  return key && shared.key === key ? shared.header : null;
}

/** The ids of the AI actions the Ticket screen offers for this record, or null when it has not said. */
export function sharedOfferedIds(key) {
  return key && shared.key === key ? shared.offered : null;
}
