// Context specs for knowledge articles and chat conversations (see docs/contracts.md, "Context specs").
//
// Two new record kinds live here. `knowledge` is kb_knowledge. `chat` is the conversation side of a chat or messaging
// session: the interaction record, a Virtual Agent / Agent Chat conversation, a Connect Support group and a chat queue entry.
// The ceiling below is what a feature of these kinds may EVER read; each feature below lists the subset it needs.

// Why each column is in the ceiling (a column that is not here can never be read):
const KNOWLEDGE_CEILING = [
  'number', // the KB number, how a person recognises the article
  'short_description', // the article title
  'text', // the body (HTML; turned into plain text and capped at limits.text), needed for improvements and for merging
  'workflow_state', // draft / review / published ...: an unpublished article is judged differently
  'kb_knowledge_base', // which knowledge base it belongs to (scope of the duplicate finder)
  'kb_category', // its category (scope of the duplicate finder, context for improvements)
  'article_type', // html or wiki: a wiki article keeps its body elsewhere, so an empty text is not "no content"
  'meta', // the article's search keywords
  'published', // first published date, to judge how long it has been live
  'valid_to', // the expiry date: an expired or soon-to-expire article is a finding
  'sys_updated_on', // last change: stale articles are a finding
  'sys_view_count', // how often it was read (which instance column carries it varies, so both are asked)
  'view_count',
  'author', // a person: read so the privacy filter knows who wrote it and masks the name wherever the text mentions it
];

// The conversation record. A column a given chat table does not have is simply not returned by the Table API.
const CHAT_CEILING = [
  'number', // the interaction number
  'short_description', // the topic line, when the product fills it
  'state', // open / closed: decides whether "waiting" still means something
  'type', // chat, phone, email...: so a summary names the channel correctly
  'opened_at', // start of the conversation (duration, first response)
  'closed_at', // end of the conversation
  'assigned_to', // the agent (a person: masked by name)
  'opened_for', // the customer (a person: masked by name)
];

export default {
  spec: {
    // Deterministic checks on the article on screen (no AI): reads a little more than the AI feature gets to see.
    'article-check': { common: ['number'], by: { knowledge: KNOWLEDGE_CEILING } },
    // "Suggest improvements": no view count, no workflow state.
    'article-optimise': {
      common: ['number'],
      by: { knowledge: ['short_description', 'text', 'kb_category', 'article_type', 'meta', 'published', 'valid_to', 'sys_updated_on', 'author'] },
    },
    // Drafting one article out of several near-duplicates: the picked articles are read one by one, with their text.
    'kb-merge-draft': {
      common: ['number'],
      by: { knowledge: ['short_description', 'text', 'kb_knowledge_base', 'kb_category', 'meta', 'author'] },
    },
    // The knowledge-gap radar reads resolved incidents and cases in bulk (src/context/knowledge.js, GAP_FIELDS). This entry
    // names those columns, so the allowlist test can prove the bulk read stays inside the display ceiling. close_notes is
    // read only to learn whether a fix is written down; its text is dropped on the spot and only its length is kept. The person
    // columns (caller_id, contact, consumer) are read so the privacy filter knows those people and their names stay out of the topic.
    'kb-gap-outline': {
      common: ['number'],
      by: {
        incident: ['short_description', 'category', 'cmdb_ci', 'close_notes', 'resolved_at', 'caller_id'],
        case: ['short_description', 'category', 'cmdb_ci', 'close_notes', 'resolved_at', 'contact', 'consumer'],
      },
    },
    'chat-summary': { common: ['number'], by: { chat: CHAT_CEILING } },
    // The reply needs to know less about the conversation record than the wrap-up does.
    'chat-reply': { common: ['number'], by: { chat: ['short_description', 'state', 'type', 'assigned_to', 'opened_for'] } },
  },
  // The messages of a chat are read by src/context/chat.js instead of the notes table. Articles have no notes.
  journal: { 'article-check': false, 'article-optimise': false, 'kb-merge-draft': false, 'kb-gap-outline': false, 'chat-summary': true, 'chat-reply': true },
  // None of these reads the per-kind extras of src/context/related.js (SLAs, approvals...); their own extras come from pack.js.
  related: { 'article-check': [], 'article-optimise': [], 'kb-merge-draft': [], 'kb-gap-outline': [], 'chat-summary': [], 'chat-reply': [] },
  // Ceilings for the two new kinds, widened from the starting four with the reasons above.
  fieldsByKind: {
    knowledge: Object.freeze(KNOWLEDGE_CEILING),
    chat: Object.freeze(CHAT_CEILING),
  },
  extendFields: {},
  // An article body is long; the default cap for a text column would cut most articles short.
  limits: { text: 6000 },
};
