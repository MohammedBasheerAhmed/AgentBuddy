// The reading engine, as a file of its own (reads.bundle.js). The page script (src/content/index.js) stays small because it carries
// none of this; the panel injects this file into the tab the first time a READ needs it (src/sidepanel/ask.js). It runs in the same
// isolated world as the page script, so it hands its entry points over on the world's global under READS_KEY and does nothing else:
// no listener, no request, no page access until the page script calls it.
import { READS_KEY } from '../lib/messages.js';
import { setLanguage, SUPPORTED } from '../i18n/index.js';
import { handleRead } from './reads.js';
import { clearTableMeta } from './tableApi.js';

globalThis[READS_KEY] = Object.freeze({
  // `language`: the panel's language, which the page script sets on its own copy of the texts; this file has its own copy.
  handleRead: (op, args, options = {}) => {
    const { language, ...rest } = options;
    if (SUPPORTED.includes(language)) setLanguage(language);
    return handleRead(op, args, rest);
  },
  // The words of the tables' columns belong to the person who was signed in: the page script clears them when it retires.
  clear: clearTableMeta,
});
