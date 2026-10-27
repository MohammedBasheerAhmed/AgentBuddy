// READ operations added after the first ones in src/content/reads.js. One file per area; each exports an object of
//   opName: async (args, { deps, checkRecord, checkPack }) => plain JSON
// Every operation is GET-only (it goes through the context engine or src/content/tableApi.js), validates its own
// arguments, and never returns anything the person's own session could not read. See docs/contracts.md, 'READ operations'.
import reports from './reports.js';
import knowledge from './knowledge.js';
import chat from './chat.js';
import misc from './misc.js';

export const OPS = Object.freeze({ ...reports, ...knowledge, ...chat, ...misc });
