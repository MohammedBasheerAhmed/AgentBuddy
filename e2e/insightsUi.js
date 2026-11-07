// Helpers for the Ticket screen's Insights cards (src/sidepanel/ticket/cards), shared by scenarios i, q, r and t. Owner: Insights agent.
// The redesign: the cards are ONE list of rows (li[data-card="<id>"]); a row's button (.ab-ins-card-toggle) shows the card's title
// (.ab-ins-card-title) and its one line (.ab-ins-card-summary), and opens the card's content in place. Cards with nothing to report
// wait under the last row, "All clear in ..." (.ab-ins-clear-toggle), hidden until it is opened. Groups inside a card fold too; lists
// show three, then "Show all".
const { openScreen, openHalf, chooseTool } = require('./ui.js');

const visible = (e) => e.getClientRects().length > 0;

// Since the focus layout (docs/focus-layout.md) Insights shows five rows, one per pain point (li[data-group] with a button
// .ab-ins-group-row); a card belongs to one of them (src/features/focus.js PAIN_POINTS) or is under All tools, where choosing it shows
// it alone (with "Back"). A group with one card shows that card's content directly ([data-card] inside the group); a group with
// several shows today's card rows inside it.
const CARD_IDS = {
  'Request status': 'request',
  'Fulfilment checklist': 'checklist',
  'Article checks': 'article',
  'Chat facts': 'chat',
  'Account at a glance': 'account',
  'Missing details': 'missing',
  'Where similar tickets went': 'routing',
  'Steps that worked before': 'steps',
  'Related tickets': 'related',
  'Knowledge for this ticket': 'knowledge',
  'Recent changes on this CI or service': 'changes',
  'Known errors and open problems': 'knownErrors',
  'Risk signals': 'risk',
  'Which email fits': 'email',
  'Ticket journey': 'journey',
  'Outage spotter': 'outage',
  'Fulfilled before': 'fulfilled',
  'Ready to resolve?': 'resolve',
  "Caller's other tickets": 'caller',
};
const GROUP_OF = {
  request: 'understand',
  chat: 'understand',
  article: 'understand',
  journey: 'understand',
  checklist: 'fix',
  fulfilled: 'fix',
  steps: 'fix',
  knowledge: 'fix',
  caller: 'caller',
  account: 'caller',
  email: 'reply',
  resolve: 'close',
};

/** Back to the five when one card is shown alone. */
const backToFive = (p) => p.evaluate(() => [...document.querySelectorAll('.ab-ins-back')].find((b) => b.getClientRects().length > 0)?.click());

/** Open one of the five rows (by pain point id: 'understand', 'fix', 'caller', 'reply', 'close'). Returns whether it is there. */
async function openPain(p, group, { timeout = 15000 } = {}) {
  await openScreen(p, 'Ticket');
  await openHalf(p, 'insights');
  await backToFive(p);
  try {
    await p.waitForFunction((g) => [...document.querySelectorAll(`li[data-group="${g}"] .ab-ins-group-row`)].some((b) => b.getClientRects().length > 0), { timeout }, group);
  } catch {
    return false;
  }
  await p.evaluate((g) => {
    const b = [...document.querySelectorAll(`li[data-group="${g}"] .ab-ins-group-row`)].find((x) => x.getClientRects().length > 0);
    if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
  }, group);
  return true;
}

/**
 * Show the Ticket screen's Insights half and open the card with this title: inside its pain point's row, or alone from All tools.
 * Returns when its content is on screen.
 */
async function openCard(p, title, { timeout = 15000 } = {}) {
  const id = CARD_IDS[title];
  if (!id) throw new Error('Unknown Insights card ' + title);
  const group = GROUP_OF[id];
  if (group && (await openPain(p, group, { timeout }))) {
    // Several cards in the group: open this one's row (one card: its content is the group's content).
    await p.waitForFunction((cid) => [...document.querySelectorAll(`[data-card="${cid}"]`)].some((e) => e.getClientRects().length > 0), { timeout }, id);
    await p.evaluate((cid) => {
      const row = [...document.querySelectorAll(`li[data-card="${cid}"] > .ab-ins-card-toggle`)].find((b) => b.getClientRects().length > 0);
      if (row && row.getAttribute('aria-expanded') !== 'true') row.click();
      [...document.querySelectorAll(`[data-card="${cid}"]`)].find((e) => e.getClientRects().length > 0)?.scrollIntoView({ block: 'start' });
    }, id);
    return;
  }
  // One of the rest: All tools shows it alone.
  await openScreen(p, 'Ticket');
  await openHalf(p, 'insights');
  if (!(await chooseTool(p, new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)))) throw new Error('No All tools entry for ' + title);
  await p.waitForFunction((t) => [...document.querySelectorAll('.ab-ins-focus-title')].some((h) => h.getClientRects().length > 0 && h.innerText.trim() === t), { timeout }, title);
}

/** Open a group inside the cards (a folded list with a count) whose title matches. */
const openGroup = (p, re) =>
  p.evaluate((src) => {
    const rx = new RegExp(src);
    const b = [...document.querySelectorAll('.ab-ins-group-toggle')].find((x) => x.getClientRects().length > 0 && rx.test(x.innerText.trim()));
    if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
    return Boolean(b);
  }, re.source);

/** The one line on a card's row inside a group with several cards (shown without opening the card). */
const summaryOf = (p, title) =>
  p.evaluate((t) => {
    const b = [...document.querySelectorAll('.ab-ins-card-toggle')].find((x) => x.querySelector('.ab-ins-card-title')?.textContent.trim() === t);
    return b?.querySelector('.ab-ins-card-summary')?.textContent.trim() || '';
  }, title);

/**
 * A card's one line (by card id): on its own row inside a group with several cards; for a card alone in its group, the group's line
 * (which is that card's, or for "Understand the ticket" the first fact that needs the agent now).
 */
const cardLine = (p, id) =>
  p.evaluate((cid) => {
    const own = document.querySelector(`[data-card="${cid}"] .ab-ins-card-summary, [data-card="${cid}"] .ab-cardx-summary`);
    if (own) return own.textContent || '';
    const group = document.querySelector(`[data-card="${cid}"]`)?.closest('li[data-group]');
    return group?.querySelector('.ab-ins-pain-line')?.textContent || '';
  }, id);

/** The one line on a pain point's row (by id), shown without opening it. */
const painLine = (p, group) =>
  p.evaluate((g) => {
    const b = document.querySelector(`li[data-group="${g}"] .ab-ins-group-row`);
    return b?.querySelector('.ab-row-sub')?.textContent.trim() || '';
  }, group);

/** The visible text of one card (by id). */
const cardText = (p, id) => p.evaluate((cid) => document.querySelector(`[data-card="${cid}"]`)?.innerText || '', id);

/** Press "Show all (n)" inside a card when it has one. */
const showAllIn = (p, id) =>
  p.evaluate((cid) => {
    const card = document.querySelector(`[data-card="${cid}"]`);
    [...(card?.querySelectorAll('button.ab-showmore') || [])].filter((b) => b.getClientRects().length > 0 && /^Show all/.test(b.innerText.trim())).forEach((b) => b.click());
  }, id);

/** Press a button inside a card by its text. */
const clickInCard = (p, id, re) =>
  p.evaluate(
    (cid, src) => {
      const b = [...(document.querySelector(`[data-card="${cid}"]`)?.querySelectorAll('button') || [])].find((x) => x.getClientRects().length > 0 && new RegExp(src).test(x.innerText.trim()));
      b?.click();
      return Boolean(b);
    },
    id,
    re.source
  );

module.exports = { openCard, openPain, openGroup, summaryOf, painLine, cardLine, cardText, showAllIn, clickInCard, visible, CARD_IDS, GROUP_OF };
