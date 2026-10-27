// READ operations for chat (see src/content/ops/index.js). GET-only through the context engine.
import { chatOverview } from '../../chat/stats.js';
import { kindForTable } from '../../context/kinds.js';
import { readContextPack } from '../../context/pack.js';

export default {
  /**
   * The facts about a chat that need no AI: participants, message count, waiting time, the customer's last message.
   * Reads the conversation with the same pack the AI features use, so what is shown is exactly what would be sent.
   */
  chatOverview: async (args, { deps, checkRecord }) => {
    checkRecord(args);
    if (kindForTable(args.table) !== 'chat') throw new Error('That is not a chat conversation.');
    const pack = await readContextPack({ table: args.table, sysId: args.sysId }, deps, { feature: 'chat-summary' });
    return { number: pack.number, state: pack.fields.state || '', overview: chatOverview(pack, { now: Date.now() }), access: pack.access };
  },
};
