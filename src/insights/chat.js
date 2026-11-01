// N8, chat facts: the content script's `chatOverview` answer in the shape the card draws. It comes from the page's side of the
// extension, so it is checked: an answer that is not an overview is "the chat could not be read", never a crash. Pure.

const num = (v) => (Number.isFinite(v) ? v : null);

export function chatOverviewOf(answer) {
  const o = answer && typeof answer === 'object' ? answer.overview : null;
  if (!o || typeof o !== 'object') throw new Error('The chat could not be read. Try again.');
  return {
    overview: {
      ...o,
      count: Number.isFinite(o.count) ? o.count : 0,
      byCustomer: num(o.byCustomer) ?? 0,
      byAgent: num(o.byAgent) ?? 0,
      byBot: num(o.byBot) ?? 0,
      waitingMinutes: num(o.waitingMinutes),
      durationMinutes: num(o.durationMinutes),
      firstResponseMinutes: num(o.firstResponseMinutes),
      participants: Array.isArray(o.participants) ? o.participants.filter((p) => p && typeof p.name === 'string') : [],
      lastCustomer: o.lastCustomer && typeof o.lastCustomer.text === 'string' ? o.lastCustomer : null,
      lastMessage: o.lastMessage && typeof o.lastMessage.text === 'string' ? o.lastMessage : null,
    },
    access: Array.isArray(answer.access) ? answer.access : [],
  };
}

export const CHAT_WAITING_WARN_MINUTES = 5;
