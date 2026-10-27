// The parts (untrusted data for the firewall) of the two chat AI features. Pure.
//
// Every line of the conversation is labelled with who said it as FIXED wording ("Customer message", "Agent message"); the
// sender's name and the time go inside the text, where the firewall masks them. Messages use the field name `comments`, the
// same as customer-visible comments on a ticket, so a policy that blocks that field blocks chats too.

const clip = (text, max) => {
  const value = String(text ?? '').trim();
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…` : value;
};

const SIDE_LABEL = {
  customer: 'Customer message',
  agent: 'Agent message',
  bot: 'Bot message',
  '': 'Message from an unknown sender',
};

/** One chat line as it goes into a part: "[time] Name: text" (a bot has no name). */
export function messageLine(m) {
  const who = m.by ? `${m.by}: ` : '';
  return `[${m.when || ''}] ${who}${m.text}`;
}

/**
 * The record details, the conversation (newest `journal` messages, oldest first) and, when the pack carries them, the
 * knowledge articles found for the customer's last message.
 * @param {object} pack ContextPack of kind 'chat'
 * @param {{ journal?: number, lastMessage?: boolean }} [options] lastMessage: also send the customer's latest message on its
 *   own, so the model knows exactly what to answer
 */
export function chatParts(pack, { journal = 40, lastMessage = false } = {}) {
  const parts = [];
  const f = pack?.fields || {};
  const push = (label, field, text, max = 300) => {
    const value = clip(text, max);
    if (value) parts.push({ label, field, text: value });
  };
  push('Topic', 'short_description', f.short_description);
  push('Channel', 'type', f.type, 40);
  push('Chat state', 'state', f.state, 40);
  push('Started', 'opened_at', f.opened_at, 40);
  push('Ended', 'closed_at', f.closed_at, 40);

  const messages = (Array.isArray(pack?.journal) ? pack.journal : []).filter((m) => m && m.text).slice(-Math.max(0, journal));
  for (const m of messages) parts.push({ label: SIDE_LABEL[m.side || ''] || SIDE_LABEL[''], field: 'comments', text: messageLine(m) });

  if (lastMessage) {
    const mine = [...messages].reverse().find((m) => m.side === 'customer') || messages[messages.length - 1];
    if (mine) parts.push({ label: 'Reply to this customer message', field: 'comments', text: messageLine(mine) });
  }

  for (const a of (pack?.related?.knowledge || []).slice(0, 3)) {
    push('Knowledge article that may help', 'text', `${a.number}: ${a.title}${a.excerpt ? `\n${a.excerpt}` : ''}`, 900);
  }
  return parts;
}
