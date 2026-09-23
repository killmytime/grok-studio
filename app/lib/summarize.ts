import { resolveChatBackend } from './backends';
import { KEEP_PREFIX, MAX_RECENT, shouldAutoSummarize, usableTurns } from './chat-context';
import { getConversation, getSetting, listMessages, updateConversationSummary } from './db';
import { assertChatConfigured, fetchChatCompletions } from './providers/chat';

export const DEFAULT_SUMMARY_PROMPT = `请用中文将以下对话历史压缩成一段简洁的摘要（200-300字以内），保留：
- 用户的核心偏好、设定、角色关系
- 已讨论的重要事实和决定
- 当前的剧情/任务进度
不要添加多余的解释，直接输出摘要正文。`;

export const TITLE_PROMPT = '用 8-12 个字为这个对话取一个简短标题，不要引号，直接输出标题。';

async function completeOnce(messages: { role: string; content: string }[], maxTokens: number, temperature: number) {
  const backend = resolveChatBackend();
  const configured = assertChatConfigured(backend);
  if (configured) {
    const e = new Error(configured) as Error & { status: number };
    e.status = 400;
    throw e;
  }
  const res = await fetchChatCompletions(
    { messages, max_tokens: maxTokens, temperature, stream: false },
    backend
  );
  if (!res.ok) {
    const errText = await res.text();
    const e = new Error(`Upstream error: ${res.status} ${errText}`) as Error & { status: number };
    e.status = 502;
    throw e;
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim() || null;
}

export async function runConversationSummary(convId: string): Promise<string | null> {
  const conv = getConversation(convId);
  if (!conv) return null;
  const turns = usableTurns(listMessages(convId));
  const recentCount = Math.min(MAX_RECENT, Math.max(0, turns.length - KEEP_PREFIX));
  const middle = turns.slice(KEEP_PREFIX, turns.length - recentCount);

  let text = '';
  if (conv.summary) text += `【上次摘要】\n${conv.summary}\n\n`;
  if (middle.length) {
    text += middle.map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n');
  }
  if (!text.trim()) return conv.summary || null;

  const summaryPrompt = getSetting('summary_prompt', DEFAULT_SUMMARY_PROMPT);
  const summary = await completeOnce(
    [
      { role: 'system', content: summaryPrompt },
      { role: 'user', content: text },
    ],
    400,
    0.3
  );
  if (!summary) return null;
  updateConversationSummary(convId, summary);
  return summary;
}

export async function maybeAutoSummarize(convId: string): Promise<string | null> {
  const conv = getConversation(convId);
  if (!conv) return null;
  const msgs = usableTurns(listMessages(convId));
  if (!shouldAutoSummarize(msgs.length, conv.summary, conv.summary_updated_at, msgs.map((m) => m.created_at || ''))) {
    return null;
  }
  return runConversationSummary(convId);
}
