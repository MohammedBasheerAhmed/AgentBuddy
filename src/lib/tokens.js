// How much text a model can take, and an estimate of how much a request is, without a tokenizer.
//
// WHY. A request that is longer than the model's context is not refused by every server: Ollama's OpenAI-compatible endpoint
// silently drops the START of the prompt (the fixed rules and the task) and answers from what is left, and that endpoint cannot be
// asked for a larger context (num_ctx). So the pipeline (src/lib/pipeline.js) estimates the size of every request before it is sent
// and, when it would not fit, leaves out the oldest notes first. The system rules are never cut.
//
// THE ESTIMATE is deliberately on the high side: about 4 characters per token for plain ASCII text, one token per character for
// scripts written without spaces (Chinese, Japanese, Korean, Thai), 2.5 characters per token for other letters (Cyrillic, Greek,
// accented Latin), and 20% on top of that for numbers, timestamps, placeholders and the like, which split into more tokens than prose.
// Over-estimating only means a long ticket loses an old note a little earlier; under-estimating would let the server cut the rules.
//
// THE CONTEXT of a model is known for the common cloud models by name. A model on this computer (Ollama, LM Studio...) is assumed to
// have Ollama's default context of 4096 tokens unless the setup says otherwise (`config.contextTokens`), because that is what it
// gets when nobody changed it. An unknown cloud model is assumed to take 32,000 tokens. Pure: no chrome.*, no network.

export const CHARS_PER_TOKEN = 4;
export const MARGIN = 1.2;

/** Ollama's default context (num_ctx). Its OpenAI-compatible endpoint, which Agent Buddy uses, cannot ask for more. */
export const LOCAL_CONTEXT = 4096;
/** A cloud model whose name is not known: a size every current model offers. */
export const UNKNOWN_CONTEXT = 32000;
/** The most that is kept back for the answer (the providers ask for at most 16,000 output tokens). */
export const MAX_OUTPUT_RESERVE = 16000;
const MIN_OUTPUT_RESERVE = 512;

// Per message: the role and the separators the chat format adds.
const MESSAGE_OVERHEAD = 8;

// Scripts written without spaces: about one token per character.
const isDense = (cp) =>
  (cp >= 0x0e00 && cp <= 0x0e7f) || // Thai
  (cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
  (cp >= 0x3000 && cp <= 0x30ff) || // CJK punctuation, Hiragana, Katakana
  (cp >= 0x3400 && cp <= 0x4dbf) || // CJK extension A
  (cp >= 0x4e00 && cp <= 0x9fff) || // CJK
  (cp >= 0xac00 && cp <= 0xd7af) || // Hangul syllables
  (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility
  (cp >= 0xff00 && cp <= 0xffef) || // full-width forms
  cp >= 0x1f000; // emoji and the supplementary CJK planes (often two tokens or more)

/** About how many tokens `text` is, on the high side. */
export function estimateTokens(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  let ascii = 0;
  let letters = 0;
  let dense = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) ascii += 1;
    else if (cp >= 0x1f000) dense += 2;
    else if (isDense(cp)) dense += 1;
    else letters += 1;
  }
  return Math.ceil((ascii / CHARS_PER_TOKEN + letters / 2.5 + dense) * MARGIN);
}

/** About how many tokens a list of chat messages ({ role, content }) is. */
export const estimateMessages = (messages) =>
  (Array.isArray(messages) ? messages : []).reduce((sum, m) => sum + MESSAGE_OVERHEAD + estimateTokens(m?.content), 0);

// Context sizes of the models people use, by name (a vendor prefix such as "openai/" is ignored). The first match wins.
const KNOWN_CONTEXT = [
  [/^claude/, 200000],
  [/^gpt-5/, 272000], // what GPT-5 accepts as input
  [/^gpt-4\.1/, 1000000],
  [/^gpt-4o|^gpt-4-turbo|^gpt-4-(?:1106|0125)/, 128000],
  [/^gpt-4(?:-|$)/, 8192],
  [/^gpt-3\.5/, 16385],
  [/^o[134](?:-|$)/, 200000],
  [/^gemini/, 1000000],
  [/^(?:mistral-(?:large|medium|small)|pixtral-large)/, 128000],
  [/^(?:open-)?(?:mistral|mixtral|ministral|codestral)/, 32000],
  [/^deepseek/, 64000],
  [/^(?:meta-)?llama-?3\.[1-3]/, 128000],
];

const modelName = (model) => String(model || '').trim().toLowerCase().split('/').pop();

/**
 * The context of the configured model, in tokens, and where that number comes from.
 * @param {{ model?: string, local?: boolean, contextTokens?: number }} config from resolveProviderConfig (contextTokens is optional:
 *   the size the person or the organisation says their model has)
 * @returns {{ tokens: number, source: 'setting' | 'local-default' | 'model' | 'unknown' }}
 */
export function contextWindow(config = {}) {
  const set = Number(config?.contextTokens);
  if (Number.isFinite(set) && set >= 1024) return { tokens: Math.floor(set), source: 'setting' };
  // A model on this computer gets the server's default context, whatever the model itself could take.
  if (config?.local) return { tokens: LOCAL_CONTEXT, source: 'local-default' };
  const name = modelName(config?.model);
  const hit = KNOWN_CONTEXT.find(([re]) => re.test(name));
  return hit ? { tokens: hit[1], source: 'model' } : { tokens: UNKNOWN_CONTEXT, source: 'unknown' };
}

/**
 * How many tokens the request (system + user message) may be: the context minus what is kept back for the answer (a quarter of the
 * context, between 512 and 16,000 tokens).
 * @returns {{ window: number, reserve: number, prompt: number, source: string }}
 */
export function promptBudget(config = {}) {
  const { tokens, source } = contextWindow(config);
  const reserve = Math.min(MAX_OUTPUT_RESERVE, Math.max(MIN_OUTPUT_RESERVE, Math.floor(tokens / 4)));
  return { window: tokens, reserve, prompt: Math.max(0, tokens - reserve), source };
}

// What one data block costs beyond its text: the <ticket_data field=".." label=".."> wrapper and the blank lines around it.
const partOverhead = (part) => estimateTokens(`<ticket_data field="${part?.field ?? ''}" label="${part?.label ?? ''}">\n\n</ticket_data>\n\n`);

/** About how many tokens a list of parts is once wrapped (an upper bound: a short field costs less in the shared fields block). */
export const estimateParts = (parts) => (Array.isArray(parts) ? parts : []).reduce((sum, p) => sum + partOverhead(p) + estimateTokens(p?.text), 0);

/**
 * Leave out droppable parts, the earliest first, until the request fits `budget` tokens. `fixed` is the estimate of everything that
 * is not a part (the system message with its rules, the instruction, the message overhead): it is never cut. At least `keep`
 * droppable parts stay (the newest), so a reply is never written without the message it answers.
 * @param {{ parts: object[], fixed: number, budget: number, droppable: (part) => boolean, keep?: number }} p
 * @returns {{ parts: object[], dropped: number, tokens: number, fits: boolean }}
 */
export function fitParts({ parts, fixed, budget, droppable, keep = 1 }) {
  const list = Array.isArray(parts) ? [...parts] : [];
  const cost = list.map((p) => partOverhead(p) + estimateTokens(p?.text));
  let total = fixed + cost.reduce((a, b) => a + b, 0);
  const candidates = list.map((p, i) => (droppable(p) ? i : -1)).filter((i) => i >= 0);
  const out = new Set();
  for (const i of candidates.slice(0, Math.max(0, candidates.length - keep))) {
    if (total <= budget) break;
    out.add(i);
    total -= cost[i];
  }
  return { parts: list.filter((_, i) => !out.has(i)), dropped: out.size, tokens: total, fits: total <= budget };
}
