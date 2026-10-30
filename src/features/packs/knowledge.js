// Feature definitions for knowledge articles (C5-C7) and chat (D1, D2). See docs/contracts.md, "Feature definition".
//
// Two of these are run by the Knowledge tab with a pack the view builds (kinds: [], so they are not on the Actions list):
// kb-merge-draft and kb-gap-outline. The article and chat features show on the Actions list of their record kinds.
// Output of every knowledge feature is Copy only, except the chat summary's ticket notes: articles are written in the article
// form by their author, and a chat reply goes into the chat window, which Agent Buddy never touches.
import { articleParts, gapParts, mergeParts } from '../../knowledge/parts.js';
import { chatParts } from '../../chat/parts.js';
import { sectionOrAll } from '../../knowledge/sections.js';
import { rulesFor } from '../../prompts/rules.js';

// The headings of the chat summary: the ticket notes Insert takes the last one (tests/prompts-contract.test.js).
export const CHAT_SUMMARY_HEADINGS = Object.freeze(['Summary', 'Outcome', 'Follow-ups', 'Suggested ticket notes']);

const clip = (text, max) => {
  const value = String(text ?? '').trim();
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…` : value;
};

// Knowledge articles that match the conversation, found with the same read the Related tab uses. The search words come from the
// topic of the chat and the customer's own messages (the last one counts most): a last message such as "still not working"
// says little on its own. This slim pack only goes to the content script of the same browser; whatever the search adds is
// untrusted text and reaches the AI only through chatParts(). A failed search never stops the reply.
async function addKnowledge(pack, { read }) {
  const messages = Array.isArray(pack.journal) ? pack.journal : [];
  const customer = messages.filter((m) => m.side === 'customer');
  const last = customer[customer.length - 1] || messages[messages.length - 1];
  if (!last?.text) return pack;
  const slim = {
    table: pack.table,
    sysId: pack.sysId,
    number: pack.number,
    fields: {
      short_description: clip(`${pack.fields?.short_description || ''} ${last.text}`, 300),
      description: clip(customer.slice(-4, -1).map((m) => m.text).join(' '), 300),
    },
    people: pack.people || [],
  };
  try {
    const found = await read('knowledge', { pack: slim });
    const raw = (found?.hits || []).slice(0, 3);
    const hits = raw.map((h) => ({ number: String(h.number || ''), title: String(h.short_description || ''), excerpt: clip(h.excerpt, 600) }));
    // The article's author is read with the hit: the name is masked exactly wherever the excerpt mentions it, and because the excerpts
    // are text written by others the person sees the outgoing text every time (pack.requirePreview).
    const known = new Set((pack.people || []).map((p) => String(p?.name || '').toLowerCase()));
    const authors = [...new Set(raw.flatMap((h) => (Array.isArray(h.people) ? h.people : [])).map((n) => clip(n, 100)).filter(Boolean))]
      .filter((name) => !known.has(name.toLowerCase()))
      .slice(0, 10)
      .map((name) => ({ role: 'reference_person', name, email: '', sysId: '' }));
    return {
      ...pack,
      people: [...(pack.people || []), ...authors],
      related: { ...pack.related, knowledge: hits },
      access: [...(pack.access || []), ...(found?.access || [])],
      ...(hits.length ? { requirePreview: true } : {}),
    };
  } catch {
    return { ...pack, access: [...(pack.access || []), { source: 'kb_knowledge', status: 'error', note: 'The knowledge base could not be searched, so the replies use the chat only.' }] };
  }
}

export default [
  {
    id: 'article-optimise',
    title: 'Suggest improvements',
    description: 'Title, keywords, structure, clarity, missing prerequisites and steps that look out of date.',
    wave: 3,
    kinds: ['knowledge'],
    parts: articleParts,
    // Copy only: the author edits the article in its own form.
    system:
      'You help a knowledge author improve one ServiceNow knowledge article. The article is in the data: its title, its text, ' +
      'its search keywords and some dates. The text was converted from HTML to plain text, so headings and formatting are gone: ' +
      'do not complain about formatting you cannot see.\n' +
      'Write suggestions under exactly these headings, in this order, each followed by short bullet points. Write "Nothing to add" under a heading that has no suggestion.\n' +
      'Title: a clearer title, or why the current one works.\n' +
      'Keywords: search words and phrases that are missing, including the words users use rather than official names.\n' +
      'Structure: how to organise it (for example symptoms, cause, numbered steps, what to do if it does not work).\n' +
      'Clarity: sentences that are vague, too long or full of jargon; quote the words you mean.\n' +
      'Missing: prerequisites, permissions, warnings or information the reader needs and the text does not give.\n' +
      'Looks outdated: steps or product names that may no longer be right, and why you suspect it (a version, a date, a menu name).\n' +
      'Rules: base every point on the article text. At most three bullets per heading. Do not rewrite the whole article. Do not invent product names, versions, links or steps that are not in the text. No greeting. At most 250 words. ' +
      rulesFor('published'),
    instruction: 'Suggest how to improve this knowledge article.',
  },
  {
    id: 'kb-merge-draft',
    title: 'Draft a merged article',
    description: 'One article drafted from near-duplicates, with the numbers to retire.',
    wave: 3,
    kinds: [],
    keepMasked: true,
    parts: mergeParts,
    system:
      'You help a knowledge manager merge near-duplicate ServiceNow knowledge articles into one. The data holds two to four articles, each with a number, a title and its text.\n' +
      'Write exactly these headings, in this order:\n' +
      'Merged title: one clear title under 90 characters, in plain words.\n' +
      'Merged article: the whole merged article as plain text. Start with one line saying what it is for, then "Before you begin" if the articles need prerequisites, then numbered steps, then "If this does not work". Keep every step and fact that appears in the articles.\n' +
      'Retire: the article numbers (for example KB0010001) that the merged article replaces, one per line, or "None" when none should be retired. Name the article you would keep, if any.\n' +
      'What changed: short bullets on what was combined, dropped or reworded, and every place where the articles disagree, so the author can check it.\n' +
      'Rules: use only what the articles say. Where they disagree, keep the safer wording and list the conflict under What changed. Never invent steps, versions, links or contact details. Keep every placeholder written in square brackets exactly as it is: the author fills them in. No greeting. At most 600 words in all. ' +
      rulesFor('published'),
    instruction: 'Draft one merged article from these near-duplicates and say which article numbers to retire.',
  },
  {
    id: 'kb-gap-outline',
    title: 'Draft an article outline',
    description: 'An outline for an article that many resolved tickets would have needed.',
    wave: 3,
    kinds: [],
    keepMasked: true,
    parts: gapParts,
    system:
      'You help a knowledge manager plan a new ServiceNow knowledge article about a topic that many resolved tickets share. The data holds the words the tickets have in common, how many tickets there were, and their category and configuration item. It does not hold the tickets themselves or their fixes.\n' +
      'Write exactly these headings, in this order:\n' +
      'Suggested title: one clear title under 90 characters, in the words a user would search for.\n' +
      'Who it is for: who has this problem and when they would look for the article.\n' +
      'Outline: a numbered list of sections, for example Symptoms, Cause (only if the data suggests one), Steps, How to check it worked, When to ask for help.\n' +
      'Facts to collect first: what the author still has to find out from the resolved tickets before writing, because the data does not say.\n' +
      'Rules: use only the data. Never invent causes, fixes, versions or links. Keep every placeholder written in square brackets exactly as it is. No greeting. At most 200 words. ' +
      rulesFor('published'),
    instruction: 'Draft an outline for a knowledge article about this topic.',
  },
  {
    id: 'chat-summary',
    title: 'Summarise this chat',
    description: 'Summary, outcome and follow-ups, with notes ready to paste into the ticket.',
    wave: 2,
    kinds: ['chat'],
    journal: 60,
    parts: (pack) => chatParts(pack, { journal: 60 }),
    // The ticket notes go into the work notes of the form that is open; when the form does not allow it, the person gets Copy.
    insert: {
      field: 'work_notes',
      label: 'Add notes to work notes',
      fieldLabel: 'Work notes',
      pick: (text) => sectionOrAll(text, 'Suggested ticket notes', CHAT_SUMMARY_HEADINGS),
    },
    system:
      'You help a service desk agent wrap up a live chat with a customer. The chat is in the data, one message per entry, labelled by who sent it.\n' +
      'Write exactly these headings, in this order:\n' +
      'Summary: two to four short sentences on what the customer asked for and what happened.\n' +
      'Outcome: one line - resolved, partly resolved, handed over, abandoned or unclear - and the reason in a few words.\n' +
      'Follow-ups: bullet points for anything the agent or the customer still has to do, or "None".\n' +
      'Suggested ticket notes: at most five short lines for the work notes of a ticket - the issue, what was tried, the result and the next step.\n' +
      'Rules: use only what is in the chat. Write "Not stated" when something is missing. Messages from a bot are context, not the customer. Do not promise anything on the agent\'s behalf. Never repeat passwords, card numbers or other secrets. No greeting. At most 170 words in all. ' +
      rulesFor('agent'),
    instruction: 'Summarise this chat for the agent.',
  },
  {
    id: 'chat-reply',
    title: 'Suggest replies',
    description: 'Three short replies to the customer\'s last message, using the chat and the knowledge base.',
    wave: 2,
    kinds: ['chat'],
    journal: 14,
    parts: (pack) => chatParts(pack, { journal: 14, lastMessage: true }),
    enrich: addKnowledge,
    // Copy only: a reply goes into the chat window, which Agent Buddy never writes to.
    system:
      'You help a service desk agent answer a customer in a live chat. The chat is in the data, one message per entry, labelled by who sent it. ' +
      'Knowledge articles that may help are included when the knowledge base had a match.\n' +
      'Write exactly three replies the agent could send to the customer\'s most recent message, numbered 1 to 3. Each is one to three short sentences in plain, friendly words. Make them different:\n' +
      '1. Answers the question directly, using a knowledge article when one applies.\n' +
      '2. Asks the one question that would help most.\n' +
      '3. A short holding reply that is honest about what happens next.\n' +
      'Rules: ground every reply in the chat and the knowledge articles. Never promise a fix, a time, a refund or an outcome that the data does not support. If the data does not say something, ask or say you will check. ' +
      'Never include passwords, codes or other people\'s details. Do not add a signature. At most 40 words per reply. ' +
      rulesFor('customer'),
    instruction: 'Write three replies to the customer\'s most recent message.',
  },
];
