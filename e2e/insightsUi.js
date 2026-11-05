// Helpers for the Ticket screen's Insights cards (src/sidepanel/ticket/cards), shared by scenarios i, q, r and t. Owner: Insights agent.
// The redesign: the cards are ONE list of rows (li[data-card="<id>"]); a row's button (.ab-ins-card-toggle) shows the card's title
// (.ab-ins-card-title) and its one line (.ab-ins-card-summary), and opens the card's content in place. Cards with nothing to report
// wait under the last row, "All clear in ..." (.ab-ins-clear-toggle), hidden until it is opened. Groups inside a card fold too; lists
// show three, then "Show all".
const { openScreen, openHalf } = require('./ui.js');

const visible = (e) => e.getClientRects().length > 0;

/** Show the Ticket screen's Insights half and open the card with this title (if folded). Returns when its body is on screen. */
async function openCard(p, title, { timeout = 15000 } = {}) {
  await openScreen(p, 'Ticket');
  await openHalf(p, 'insights');
  // One card shown alone (the side rail or a launch from the page chose it): back to the list first ("All insights").
  await p.evaluate(() => [...document.querySelectorAll('.ab-ins-back')].find((b) => b.getClientRects().length > 0)?.click());
  // The card's row: on screen, or waiting under "All clear in ..." (its row is hidden until that row is opened).
  await p.waitForFunction(
    (t) =>
      [...document.querySelectorAll('.ab-ins-card-toggle')].some((b) => b.querySelector('.ab-ins-card-title')?.textContent.trim() === t && (b.getClientRects().length > 0 || b.closest('li[data-card][hidden]'))),
    { timeout },
    title
  );
  await p.evaluate((t) => {
    const b = [...document.querySelectorAll('.ab-ins-card-toggle')].find((x) => x.querySelector('.ab-ins-card-title')?.textContent.trim() === t && (x.getClientRects().length > 0 || x.closest('li[data-card][hidden]')));
    if (b && b.getClientRects().length === 0) [...document.querySelectorAll('.ab-ins-clear-toggle')].find((c) => c.getClientRects().length > 0 && c.getAttribute('aria-expanded') !== 'true')?.click();
  }, title);
  await p.waitForFunction((t) => [...document.querySelectorAll('.ab-ins-card-toggle')].some((b) => b.getClientRects().length > 0 && b.querySelector('.ab-ins-card-title')?.innerText.trim() === t), { timeout: 5000 }, title);
  await p.evaluate((t) => {
    const b = [...document.querySelectorAll('.ab-ins-card-toggle')].find((x) => x.getClientRects().length > 0 && x.querySelector('.ab-ins-card-title')?.innerText.trim() === t);
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

/** The one line on a card's row (shown without opening it), also for a card waiting under "All clear in ...". */
const summaryOf = (p, title) =>
  p.evaluate((t) => {
    const b = [...document.querySelectorAll('.ab-ins-card-toggle')].find((x) => x.querySelector('.ab-ins-card-title')?.textContent.trim() === t && (x.getClientRects().length > 0 || x.closest('li[data-card][hidden]')));
    return b?.querySelector('.ab-ins-card-summary')?.textContent.trim() || '';
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
