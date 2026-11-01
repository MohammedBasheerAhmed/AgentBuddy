// Helpers for the Ticket screen's Insights cards (src/sidepanel/ticket/cards), shared by scenarios i, q and r. Owner: Insights agent.
// A card is a CardFrame with data-card="<id>"; its title button folds it; groups inside fold too; lists show three, then "Show all".
const { openScreen, openHalf } = require('./ui.js');

const visible = (e) => e.getClientRects().length > 0;

/** Show the Ticket screen's Insights half and open the card with this title (if folded). Returns when its body is on screen. */
async function openCard(p, title, { timeout = 15000 } = {}) {
  await openScreen(p, 'Ticket');
  await openHalf(p, 'insights');
  await p.waitForFunction(
    (t) => [...document.querySelectorAll('.ab-cardx-toggle')].some((b) => b.getClientRects().length > 0 && b.querySelector('.ab-cardx-title')?.innerText.trim() === t),
    { timeout },
    title
  );
  await p.evaluate((t) => {
    const b = [...document.querySelectorAll('.ab-cardx-toggle')].find((x) => x.getClientRects().length > 0 && x.querySelector('.ab-cardx-title')?.innerText.trim() === t);
    if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
    b?.scrollIntoView({ block: 'start' });
  }, title);
}

/** Open a group inside the cards (a folded list with a count) whose title matches. */
const openGroup = (p, re) =>
  p.evaluate((src) => {
    const rx = new RegExp(src);
    const b = [...document.querySelectorAll('.ab-ins-group-toggle')].find((x) => x.getClientRects().length > 0 && rx.test(x.innerText.trim()));
    if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
    return Boolean(b);
  }, re.source);

/** The summary line next to a card's title. */
const summaryOf = (p, title) =>
  p.evaluate((t) => {
    const b = [...document.querySelectorAll('.ab-cardx-toggle')].find((x) => x.getClientRects().length > 0 && x.querySelector('.ab-cardx-title')?.innerText.trim() === t);
    return b?.querySelector('.ab-cardx-summary')?.innerText.trim() || '';
  }, title);

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

module.exports = { openCard, openGroup, summaryOf, cardText, showAllIn, clickInCard, visible };
