import { MSG } from '../lib/messages.js';

/** Send one message to the content script of a tab and unwrap its answer; errors from the page come back as Error with .code. */
export async function ask(tabId, message) {
  const answer = await chrome.tabs.sendMessage(tabId, message);
  if (answer?.error) {
    const err = new Error(answer.error.message);
    err.code = answer.error.code;
    throw err;
  }
  return answer;
}

/** A READ operation (src/content/reads.js and src/content/ops/*). */
export const read = (tabId, op, args = {}) => ask(tabId, { type: MSG.READ, op, args });
