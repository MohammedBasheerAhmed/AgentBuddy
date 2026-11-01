// Provider-neutral conversation format and the converters to each vendor's wire
// format. Pure functions, so they are unit-tested without any network.
//
// Neutral messages:
//   { role: 'system' | 'user', content }
//   { role: 'assistant', content, toolCalls?: [{ id, name, args }], raw?: { provider, blocks } }
//   { role: 'tool', toolCallId, name, content, isError? }
//
// `raw` carries the vendor's own assistant blocks. Anthropic requires thinking
// blocks to be sent back unchanged within a tool loop, so the adapter replays
// `raw` when it came from the same provider instead of rebuilding the turn.
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
  const out = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        }));
      }
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: String(m.content ?? '') });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function toOpenAITools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));
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
  if (!message) throw new AiError(t('{who} sent an answer without a message. Check the address and the model in Settings.', { who }), 'BAD_ANSWER');
  const toolCalls = (message.tool_calls || []).map((c) => ({
    id: c.id,
    name: c.function?.name,
    args: parseJsonObject(c.function?.arguments),
  }));
  const content = typeof message.content === 'string' ? message.content : '';
  const stopReason = OPENAI_STOP[choice.finish_reason] || (toolCalls.length ? 'tool_use' : 'end_turn');
  if (!content && !toolCalls.length) {
    if (stopReason === 'content_filter') throw new AiError(t('{who} stopped the answer with its content filter. Change the text, or ask your administrator about the filter.', { who }), 'CONTENT_FILTER');
    // A reasoning model can spend the whole output limit thinking and return nothing.
    if (stopReason === 'max_tokens') throw new AiError(t('The answer was cut short before any text came back. Try again with less text, or choose a model with a larger output limit.'), 'CUT_SHORT');
    if (typeof message.refusal === 'string' && message.refusal) throw new AiError(t('The model declined this request. Rephrase it or try a different model in Agent Buddy settings.'), 'REFUSED');
    throw new AiError(t('{who} sent an empty answer. Try again.', { who }), 'EMPTY_ANSWER');
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

export function toAnthropicTools(tools) {
  return tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
}

/** { system, messages } in the Messages API shape. */
export function toAnthropicRequest(messages) {
  const system = [];
  const out = [];

  const push = (role, content) => {
    const last = out[out.length - 1];
    // Parallel tool results must share one user message.
    if (last && last.role === role && Array.isArray(last.content) && Array.isArray(content)) {
      last.content.push(...content);
    } else {
      out.push({ role, content });
    }
  };

  for (const m of messages) {
    if (m.role === 'system') {
      system.push(m.content);
    } else if (m.role === 'tool') {
      push('user', [
        { type: 'tool_result', tool_use_id: m.toolCallId, content: String(m.content ?? ''), ...(m.isError ? { is_error: true } : {}) },
      ]);
    } else if (m.role === 'assistant') {
      if (m.raw?.provider === 'anthropic' && Array.isArray(m.raw.blocks)) {
        out.push({ role: 'assistant', content: m.raw.blocks });
      } else {
        const blocks = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        (m.toolCalls || []).forEach((c) => blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} }));
        if (blocks.length) out.push({ role: 'assistant', content: blocks });
      }
    } else {
      push('user', m.content);
    }
  }
  return { system: system.join('\n\n'), messages: out };
}

// Anthropic's stop reasons that mean the text ends before the model finished: the output limit, or the context window filling up.
const ANTHROPIC_CUT = new Set(['max_tokens', 'model_context_window_exceeded']);

export function fromAnthropicResponse(data) {
  if (data?.stop_reason === 'refusal') {
    // stop_details is only filled for a refusal; its category is a short word such as "cyber" (never request text).
    const raw = data.stop_details?.category;
    const category = typeof raw === 'string' && /^[a-z_]{1,40}$/.test(raw) ? raw : '';
    throw new AiError(
      category
        ? t('The model declined this request ({category}). Rephrase it or try a different model in Agent Buddy settings.', { category })
        : t('The model declined this request. Rephrase it or try a different model in Agent Buddy settings.'),
      'REFUSED'
    );
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
    if (cut) throw new AiError(t('The answer was cut short before any text came back. Try again with less text, or choose a model with a larger output limit.'), 'CUT_SHORT');
    throw new AiError(t('The model returned no content. Try again.'), 'EMPTY_ANSWER');
  }
  return {
    content,
    toolCalls,
    raw: { provider: 'anthropic', blocks },
    stopReason: cut ? 'max_tokens' : data.stop_reason === 'tool_use' || toolCalls.length ? 'tool_use' : 'end_turn',
    truncated: cut,
    // Anthropic reports cache reads and writes separately from input_tokens (which excludes both).
    usage: {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
      cacheRead: data.usage?.cache_read_input_tokens || 0,
      cacheWrite: data.usage?.cache_creation_input_tokens || 0,
    },
  };
}

const EPHEMERAL = { type: 'ephemeral' };
const CACHEABLE_BLOCKS = new Set(['text', 'tool_result', 'tool_use', 'image', 'document']);

/**
 * Prompt caching: mark the end of the stable prefix so the next call in a conversation (or an agent's tool loop) is
 * billed at the cheap cache-read rate for everything before it. Three breakpoints, in prefix order: the last tool
 * definition, the system prompt, and the last block of the last message (the whole conversation so far). Pure: returns a
 * new request body and leaves the argument alone. Thinking blocks cannot carry cache_control, so a trailing assistant
 * turn is left unmarked.
 */
export function applyCacheControl(body) {
  const out = { ...body };
  if (Array.isArray(out.tools) && out.tools.length) {
    out.tools = out.tools.map((tool, i) => (i === out.tools.length - 1 ? { ...tool, cache_control: EPHEMERAL } : tool));
  }
  if (typeof out.system === 'string' && out.system) {
    out.system = [{ type: 'text', text: out.system, cache_control: EPHEMERAL }];
  }
  if (Array.isArray(out.messages) && out.messages.length) {
    const messages = out.messages.slice();
    const last = messages[messages.length - 1];
    if (typeof last.content === 'string' && last.content) {
      messages[messages.length - 1] = { ...last, content: [{ type: 'text', text: last.content, cache_control: EPHEMERAL }] };
    } else if (Array.isArray(last.content) && last.content.length) {
      const index = last.content.length - 1;
      const block = last.content[index];
      if (block && CACHEABLE_BLOCKS.has(block.type)) {
        messages[messages.length - 1] = { ...last, content: last.content.map((b, i) => (i === index ? { ...b, cache_control: EPHEMERAL } : b)) };
      }
    }
    out.messages = messages;
  }
  return out;
}
