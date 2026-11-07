// Provider-neutral conversation format and the converters to each vendor's wire
// format. Pure functions, so they are unit-tested without any network.
//
// Neutral messages are what the PII firewall seals (src/pii/firewall.js): { role: 'system' | 'user', content } with text content.
// The model is never given tools. An answer is read for its text, its usage and why it stopped; tool calls in it are still read, so an
// answer that has only those is not taken for an empty one.
import { AiError } from './http.js';
import { t } from '../i18n/index.js';

function parseJsonObject(text) {
  if (text && typeof text === 'object') return text;
  try {
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

// ---- OpenAI ------------------------------------------------------------------

export function toOpenAIMessages(messages) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

// prompt_tokens includes the tokens served from the cache, so the neutral `input` is the part that was NOT cached.
function openAIUsage(usage) {
  const prompt = usage?.prompt_tokens || 0;
  const cached = Math.min(prompt, usage?.prompt_tokens_details?.cached_tokens || usage?.cached_tokens || 0);
  return { input: prompt - cached, output: usage?.completion_tokens || 0, cacheRead: cached, cacheWrite: 0 };
}

// Why an answer stopped, in the neutral words both adapters use. 'max_tokens' means the text was cut short by the output limit;
// 'content_filter' means the provider's filter stopped it part-way (Azure OpenAI does this).
const OPENAI_STOP = { length: 'max_tokens', content_filter: 'content_filter', tool_calls: 'tool_use', function_call: 'tool_use' };

/** `who` names the provider in the messages ("Azure OpenAI could not..."); the neutral shape is the same for every provider. */
export function fromOpenAIResponse(data, who = t('The AI service')) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  if (!message) throw new AiError(t('{who} sent an answer without any text. Check the AI address and the model in Settings.', { who }), 'BAD_ANSWER');
  const toolCalls = (message.tool_calls || []).map((c) => ({
    id: c.id,
    name: c.function?.name,
    args: parseJsonObject(c.function?.arguments),
  }));
  const content = typeof message.content === 'string' ? message.content : '';
  const stopReason = OPENAI_STOP[choice.finish_reason] || (toolCalls.length ? 'tool_use' : 'end_turn');
  if (!content && !toolCalls.length) {
    // An answer that came back but cannot be used was still billed: its usage goes with the error, so the usage log, the daily caps
    // and the organisation's token budget count it (src/providers/index.js).
    const billed = { usage: openAIUsage(data.usage) };
    if (stopReason === 'content_filter') throw new AiError(t('{who} stopped the answer with its content filter. Change the text, or ask your administrator about the filter.', { who }), 'CONTENT_FILTER', billed);
    // A reasoning model can spend the whole output limit thinking and return nothing.
    if (stopReason === 'max_tokens') throw new AiError(t('The answer was cut short before any text came back. Try again with less text, or choose a model with a larger output limit.'), 'CUT_SHORT', billed);
    if (typeof message.refusal === 'string' && message.refusal) throw new AiError(t('The AI declined this request. Rephrase it, or choose a different model in Settings.'), 'REFUSED', billed);
    throw new AiError(t('{who} sent an empty answer. Try again.', { who }), 'EMPTY_ANSWER', billed);
  }
  return {
    content,
    toolCalls,
    stopReason,
    // The text stops part-way: the person must be told the answer is incomplete.
    truncated: stopReason === 'max_tokens' || stopReason === 'content_filter',
    usage: openAIUsage(data.usage),
  };
}

/**
 * The sentence for an answer that stopped part-way ('' when it is whole), to show next to the answer: the person must not take a
 * cut-off draft for a finished one. Pure, so the run pipeline (src/lib/pipeline.js) can use it without the network code.
 */
export const truncationNote = (reply) =>
  reply?.truncated
    ? reply.stopReason === 'content_filter'
      ? t("The answer stops part-way: the AI service's content filter cut it off. Check it carefully before you use it.")
      : t('The answer was cut short because it reached the length limit. Check the end before you use it, or try again with less text.')
    : '';

// ---- Anthropic ---------------------------------------------------------------

/** { system, messages } in the Messages API shape: the system text apart, every other message as the user's. */
export function toAnthropicRequest(messages) {
  const system = [];
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') system.push(m.content);
    else out.push({ role: 'user', content: m.content });
  }
  return { system: system.join('\n\n'), messages: out };
}

// Anthropic's stop reasons that mean the text ends before the model finished: the output limit, or the context window filling up.
const ANTHROPIC_CUT = new Set(['max_tokens', 'model_context_window_exceeded']);

export function fromAnthropicResponse(data) {
  // Anthropic reports cache reads and writes separately from input_tokens (which excludes both).
  const usage = {
    input: data?.usage?.input_tokens || 0,
    output: data?.usage?.output_tokens || 0,
    cacheRead: data?.usage?.cache_read_input_tokens || 0,
    cacheWrite: data?.usage?.cache_creation_input_tokens || 0,
  };
  // A refused, empty or cut-off answer was still billed: its usage goes with the error (see fromOpenAIResponse).
  const billed = { usage };
  if (data?.stop_reason === 'refusal') {
    // stop_details is only filled for a refusal; its category is a short word such as "cyber" (never request text).
    const raw = data.stop_details?.category;
    const category = typeof raw === 'string' && /^[a-z_]{1,40}$/.test(raw) ? raw : '';
    // (the category goes on the error for the audit log and support, not into the sentence a person reads)
    throw new AiError(t('The AI declined this request. Rephrase it, or choose a different model in Settings.'), 'REFUSED', category ? { ...billed, category } : billed);
  }
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const content = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const toolCalls = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, args: parseJsonObject(b.input) }));
  const cut = ANTHROPIC_CUT.has(data?.stop_reason);
  if (!content && !toolCalls.length) {
    if (cut) throw new AiError(t('The answer was cut short before any text came back. Try again with less text, or choose a model with a larger output limit.'), 'CUT_SHORT', billed);
    throw new AiError(t('The model returned no content. Try again.'), 'EMPTY_ANSWER', billed);
  }
  return {
    content,
    toolCalls,
    stopReason: cut ? 'max_tokens' : data.stop_reason === 'tool_use' || toolCalls.length ? 'tool_use' : 'end_turn',
    truncated: cut,
    usage,
  };
}
