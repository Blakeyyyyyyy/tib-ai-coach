'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { v4 as uuidv4 } from 'uuid';
import {
  Send,
  CheckSquare,
  ExternalLink,
  Video,
  Radio,
  BookOpen,
  Wrench,
  Loader2,
  ArrowRight,
  Copy,
  Check,
  FileText,
} from 'lucide-react';
import type { ChatRagPayload } from '@/lib/ai/chat-rag-payload';
import { parseChatStreamLine } from '@/lib/ai/chat-stream';
import {
  coachJsonPastAnswerField,
  extractStreamingAnswer,
  parseAIResponse,
  tryParseStreamingCoachJson,
} from '@/lib/ai/coach';
import { AIResponse, TaskFromAI } from '@/lib/types';
import { dedupeRagSourcesForDisplay } from '@/lib/rag-sources-dedupe';
import { citationHrefFromSource } from '@/lib/rag-source-from-row';
import { useCoachSessions } from '@/contexts/CoachSessionsContext';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parsed?: AIResponse;
  created_at: string;
  /** True while the answer text is still streaming */
  streaming?: boolean;
  streamStatus?: string;
  /** Answer done; waiting for tasks / PDF block JSON */
  finishingStructured?: boolean;
}

const resourceIcons: Record<string, typeof Video> = {
  video: Video,
  podcast: Radio,
  blog: BookOpen,
  tool: Wrench,
};

function chatApiErrorMessage(
  status: number,
  raw: string,
  contentType: string | null
): string {
  if (status === 401) {
    return 'Your session expired. Please refresh the page and sign in again.';
  }
  const trimmed = raw.trimStart();
  if (
    !trimmed ||
    trimmed.startsWith('<!') ||
    trimmed.startsWith('<html') ||
    contentType?.includes('text/html')
  ) {
    if (!trimmed) return 'Empty response from the server. Please try again.';
    return 'Unexpected response from the server. Refresh the page and sign in again.';
  }
  return `Invalid response from the server (${status})`;
}

function rowsToMessages(
  rows: {
    id: string;
    role: string;
    content: string;
    resources: unknown;
    tasks_created: unknown;
    rag_sources?: unknown;
    created_at: string;
  }[]
): ChatMessage[] {
  return rows.map((row) => {
    if (row.role === 'assistant') {
      const resources = (row.resources as AIResponse['resources']) || [];
      const tasks = (row.tasks_created as TaskFromAI[]) || [];
      const rag_sources = Array.isArray(row.rag_sources)
        ? (row.rag_sources as AIResponse['rag_sources'])
        : undefined;
      return {
        id: row.id,
        role: 'assistant',
        content: row.content,
        created_at: row.created_at,
        parsed: {
          answer: row.content,
          next_steps: [],
          tasks,
          resources,
          ...(rag_sources && rag_sources.length > 0 ? { rag_sources } : {}),
        },
      };
    }
    return {
      id: row.id,
      role: 'user',
      content: row.content,
      created_at: row.created_at,
    };
  });
}

export default function CoachChat({
  conversationId: routeConversationId,
}: {
  conversationId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { bumpConversations, listVersion } = useCoachSessions();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** Set after creating a row on /coach until the URL catches up with `router.replace`. */
  const [pendingConvId, setPendingConvId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(!!routeConversationId);
  const [userId, setUserId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Conversation id currently reflected in `messages` (skip DB reload after URL update). */
  const messagesConvIdRef = useRef<string | null>(null);
  /** User is near the bottom — auto-scroll on new content; false after they scroll up. */
  const stickToBottomRef = useRef(true);
  /** Next messages update should scroll (e.g. user just sent, or opened a conversation). */
  const forceScrollOnNextUpdateRef = useRef(false);

  const SCROLL_BOTTOM_THRESHOLD_PX = 80;

  const updateStickToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current =
      distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const touchConversation = useCallback(async (convId: string) => {
    const supabase = createClient();
    await supabase
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId);
  }, []);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setUserId(user.id);
      const savedPrompt = sessionStorage.getItem('coach_prompt');
      if (savedPrompt) {
        sessionStorage.removeItem('coach_prompt');
        setInput(savedPrompt);
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!routeConversationId) {
      setConversationTitle(null);
      return;
    }
    let cancelled = false;
    async function loadTitle() {
      const supabase = createClient();
      const { data } = await supabase
        .from('conversations')
        .select('title')
        .eq('id', routeConversationId)
        .single();
      if (!cancelled && data?.title) setConversationTitle(data.title);
    }
    loadTitle();
    return () => {
      cancelled = true;
    };
  }, [routeConversationId, listVersion]);

  useEffect(() => {
    if (!routeConversationId) {
      setMessages([]);
      setPendingConvId(null);
      messagesConvIdRef.current = null;
      setLoadingHistory(false);
      stickToBottomRef.current = true;
      return;
    }

    if (messagesConvIdRef.current !== routeConversationId) {
      stickToBottomRef.current = true;
      forceScrollOnNextUpdateRef.current = true;
    }

    if (
      messagesConvIdRef.current === routeConversationId &&
      messages.length > 0
    ) {
      setPendingConvId(null);
      setLoadingHistory(false);
      return;
    }

    let cancelled = false;
    async function loadHistory() {
      setLoadingHistory(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from('messages')
        .select('id, role, content, resources, tasks_created, rag_sources, created_at')
        .eq('conversation_id', routeConversationId)
        .order('created_at', { ascending: true });
      if (!cancelled && !error && data) {
        setMessages(rowsToMessages(data));
        messagesConvIdRef.current = routeConversationId;
      }
      if (!cancelled) {
        setPendingConvId(null);
        setLoadingHistory(false);
      }
    }
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [routeConversationId]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => updateStickToBottom();
    el.addEventListener('scroll', onScroll, { passive: true });
    updateStickToBottom();
    return () => el.removeEventListener('scroll', onScroll);
  }, [updateStickToBottom, loadingHistory, routeConversationId]);

  useEffect(() => {
    const shouldScroll =
      forceScrollOnNextUpdateRef.current || stickToBottomRef.current;
    if (!shouldScroll) return;

    const force = forceScrollOnNextUpdateRef.current;
    forceScrollOnNextUpdateRef.current = false;

    const streaming = messages.some(
      (m) =>
        m.role === 'assistant' &&
        (m.streaming || m.finishingStructured || m.streamStatus)
    );
    const behavior: ScrollBehavior =
      force || streaming || loading ? 'auto' : 'smooth';

    const id = requestAnimationFrame(() => {
      scrollMessagesToBottom(behavior);
    });
    return () => cancelAnimationFrame(id);
  }, [
    messages,
    loading,
    loadingHistory,
    scrollMessagesToBottom,
  ]);

  const saveTasks = async (tasks: TaskFromAI[], convId: string) => {
    const valid = tasks.filter((t) => t?.title?.trim());
    if (!userId || valid.length === 0) return;
    const supabase = createClient();
    for (const task of valid) {
      const { error } = await supabase.from('tasks').insert({
        id: uuidv4(),
        user_id: userId,
        title: task.title,
        description: task.description || null,
        status: 'pending',
        source: 'ai',
        conversation_id: convId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) {
        console.error('Failed to save task:', error.message, task.title);
      }
    }
  };

  const saveMessage = async (msg: ChatMessage, convId: string) => {
    if (!userId) return;
    const supabase = createClient();
    await supabase.from('messages').insert({
      id: msg.id,
      conversation_id: convId,
      role: msg.role,
      content: msg.content,
      resources: msg.parsed?.resources || null,
      tasks_created: msg.parsed?.tasks || null,
      rag_sources: msg.parsed?.rag_sources ?? null,
      created_at: msg.created_at,
    });
  };

  const ensureConversation = async (firstLine: string): Promise<string> => {
    if (routeConversationId) return routeConversationId;
    if (pendingConvId) return pendingConvId;
    if (!userId) throw new Error('No user');
    const supabase = createClient();
    const id = uuidv4();
    const now = new Date().toISOString();
    const title = firstLine.slice(0, 60) || 'New chat';
    await supabase.from('conversations').insert({
      id,
      user_id: userId,
      title,
      created_at: now,
      updated_at: now,
    });
    setPendingConvId(id);
    messagesConvIdRef.current = id;
    bumpConversations();
    return id;
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    const convId = await ensureConversation(trimmed);
    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    stickToBottomRef.current = true;
    forceScrollOnNextUpdateRef.current = true;
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    await saveMessage(userMsg, convId);

    const assistantId = uuidv4();
    const assistantCreatedAt = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        streaming: true,
        streamStatus: 'Thinking…',
        created_at: assistantCreatedAt,
      },
    ]);

    try {
      const historyForApi = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.role === 'assistant' && m.parsed ? m.parsed.answer : m.content,
      }));

      const authFetch = (url: string, init: RequestInit) =>
        fetch(url, {
          ...init,
          credentials: 'same-origin',
          redirect: 'manual',
        });

      const assertOkSession = (res: Response) => {
        if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
          throw new Error(
            'Your session expired. Please refresh the page and sign in again.'
          );
        }
      };

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, streamStatus: 'Searching knowledge base…' }
            : m
        )
      );

      let ragPayload: ChatRagPayload | null = null;
      const ragRes = await authFetch('/api/rag/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: trimmed,
          conversationId: convId,
        }),
      });
      assertOkSession(ragRes);
      if (ragRes.ok) {
        const ragJson = (await ragRes.json()) as { rag?: ChatRagPayload | null };
        ragPayload = ragJson.rag ?? null;
        if (ragPayload?.sources?.length) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    parsed: {
                      answer: '',
                      next_steps: [],
                      tasks: [],
                      resources: [],
                      rag_sources: ragPayload!.sources,
                    },
                  }
                : m
            )
          );
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, streamStatus: 'Writing your answer…' }
            : m
        )
      );

      const res = await authFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: historyForApi,
          conversationId: convId,
          ragPayload,
        }),
      });
      assertOkSession(res);

      const contentType = res.headers.get('content-type') ?? '';
      const isStream = contentType.includes('ndjson');

      if (!res.ok) {
        const raw = await res.text();
        let errMsg = chatApiErrorMessage(res.status, raw, contentType);
        try {
          const j = JSON.parse(raw) as { error?: string };
          if (j.error) errMsg = j.error;
        } catch {
          /* use default */
        }
        throw new Error(errMsg);
      }

      if (!isStream || !res.body) {
        throw new Error('Unexpected response from chat API');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = '';
      let rawJson = '';
      let finalData: AIResponse | null = null;
      let lastAnswerPreview = '';

      const patchAssistant = (
        patch:
          | Partial<ChatMessage>
          | ((current: ChatMessage) => Partial<ChatMessage>)
      ) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const next =
              typeof patch === 'function' ? patch(m) : patch;
            return { ...m, ...next };
          })
        );
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          const event = parseChatStreamLine(line);
          if (!event) continue;

          if (event.type === 'status') {
            patchAssistant({ streamStatus: event.message });
          } else if (event.type === 'meta') {
            patchAssistant({
              parsed: {
                answer: '',
                next_steps: [],
                tasks: [],
                resources: [],
                rag_sources: event.rag_sources,
              },
            });
          } else if (event.type === 'delta') {
            rawJson += event.text;
            const preview =
              extractStreamingAnswer(rawJson) ||
              (rawJson.length > 0 && !rawJson.trimStart().startsWith('{')
                ? rawJson
                : '');
            const answerStable =
              preview.length > 0 &&
              preview === lastAnswerPreview &&
              preview.length > 40;
            lastAnswerPreview = preview;
            const finishingStructured =
              !finalData &&
              Boolean(preview) &&
              (coachJsonPastAnswerField(rawJson) || answerStable);

            const early = tryParseStreamingCoachJson(rawJson);
            if (
              early &&
              (early.tasks.length > 0 ||
                early.next_steps.length > 0 ||
                early.resources.length > 0)
            ) {
              finalData = early;
              patchAssistant((m) => ({
                content: early.answer,
                parsed: {
                  ...early,
                  rag_sources:
                    early.rag_sources?.length
                      ? early.rag_sources
                      : m.parsed?.rag_sources,
                },
                streaming: false,
                finishingStructured: false,
                streamStatus: undefined,
              }));
            } else {
              patchAssistant((m) => ({
                content: preview,
                streamStatus: undefined,
                streaming: !finishingStructured,
                finishingStructured,
                parsed: m.parsed
                  ? { ...m.parsed, answer: preview || m.parsed.answer }
                  : undefined,
              }));
            }
          } else if (event.type === 'done') {
            finalData = event.parsed;
            patchAssistant({
              content: finalData.answer,
              parsed: finalData,
              streaming: false,
              finishingStructured: false,
              streamStatus: undefined,
            });
          } else if (event.type === 'error') {
            throw new Error(event.error);
          }
        }
      }

      if (!finalData && rawJson.trim()) {
        finalData = parseAIResponse(rawJson);
        if (finalData.answer) {
          patchAssistant({
            content: finalData.answer,
            parsed: finalData,
            streaming: false,
            finishingStructured: false,
            streamStatus: undefined,
          });
        }
      }

      if (!finalData) {
        throw new Error(
          'The response ended before the coach finished replying. On Netlify this usually means the serverless function hit its time limit — ask Netlify support to raise the timeout to 26s (Pro plan) and set CHAT_RAG_DEADLINE_MS=12000 in site env vars.'
        );
      }

      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: finalData.answer,
        parsed: finalData,
        created_at: assistantCreatedAt,
        streaming: false,
      };
      messagesConvIdRef.current = convId;

      if (pathname === '/coach' && convId) {
        router.replace(`/coach/${convId}`, { scroll: false });
      }

      void (async () => {
        await saveMessage(assistantMsg, convId);
        if (finalData.tasks && finalData.tasks.length > 0) {
          await saveTasks(finalData.tasks, convId);
        }
        await touchConversation(convId);
        bumpConversations();
      })();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      const hint =
        err instanceof Error
          ? err.message
          : "Sorry, I couldn't process that. Please try again.";
      setMessages((prev) => [
        ...prev,
        {
          id: uuidv4(),
          role: 'assistant',
          content:
            hint.includes('API key') || hint.includes('not configured')
              ? `${hint}\n\nAdd ANTHROPIC_API_KEY to your .env file (Anthropic Console → API keys), then restart the dev server.`
              : `Something went wrong: ${hint}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleChipClick = (topic: string) => {
    setInput(`I need help with ${topic.toLowerCase()} in my trade business`);
    inputRef.current?.focus();
  };

  const headerLabel =
    routeConversationId && conversationTitle
      ? conversationTitle
      : routeConversationId
        ? 'Chat'
        : 'New chat';

  if (loadingHistory && routeConversationId) {
    return (
      <div className="flex flex-1 flex-col min-h-0 h-full bg-surface">
        <div className="hidden lg:flex h-12 shrink-0 items-center justify-center border-b border-black/[0.06] bg-surface px-4">
          <span className="text-sm font-medium text-ink-500">Loading…</span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-2 text-ink-400 text-sm">
            <Loader2 size={16} className="animate-spin" />
            Loading conversation…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full bg-surface">
      <div className="hidden lg:flex h-12 shrink-0 items-center justify-center border-b border-black/[0.06] bg-surface/95 px-6 backdrop-blur-sm">
        <h1 className="text-sm font-semibold text-ink-900 truncate max-w-[min(100%,32rem)] text-center">
          {headerLabel}
        </h1>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto min-h-0"
      >
        <div className="max-w-[48rem] mx-auto px-3 sm:px-4 py-6 lg:py-10">
          {messages.length === 0 ? (
            <EmptyState onChipClick={handleChipClick} />
          ) : (
            <div className="space-y-5 sm:space-y-6">
              {messages.map((msg) => (
                <div key={msg.id}>
                  {msg.role === 'user' ? (
                    <UserMessage content={msg.content} />
                  ) : (
                    <AssistantMessage
                      message={msg}
                      onCopy={handleCopy}
                      copiedId={copiedId}
                    />
                  )}
                </div>
              ))}
              {loading &&
                !messages.some((m) => m.role === 'assistant' && m.streaming) && (
                <div className="flex gap-3">
                  <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 text-[10px] font-bold text-white">
                    TiB
                  </div>
                  <div className="flex flex-1 items-center gap-2 pt-2 text-ink-400">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">Thinking</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-black/[0.06] bg-surface px-3 pb-5 pt-3 sm:px-4 lg:px-6">
        <div className="max-w-[48rem] mx-auto">
          <div className="flex items-end gap-2 rounded-3xl border border-black/[0.1] bg-white px-1 py-1.5 pl-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)] focus-within:border-black/15 focus-within:shadow-[0_2px_16px_rgba(0,0,0,0.08)]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message TiB Coach…"
              rows={1}
              className="flex-1 resize-none bg-transparent py-3 pr-2 text-[15px] leading-relaxed text-ink-900 placeholder:text-ink-400 focus:outline-none max-h-40 min-h-[44px]"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white hover:bg-ink-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Send"
            >
              <Send size={18} />
            </button>
          </div>
          <p className="text-center text-[11px] text-ink-400 mt-2.5 px-2 leading-snug">
            TiB Coach can make mistakes. Check important advice against your situation and local rules.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onChipClick }: { onChipClick: (t: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[42vh] sm:min-h-[48vh] text-center px-2">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-900 text-lg font-bold text-white shadow-md">
        TiB
      </div>
      <h2 className="text-2xl sm:text-[1.75rem] font-semibold tracking-tight text-ink-900 mb-2">
        What can I help you with?
      </h2>
      <p className="text-ink-500 text-sm sm:text-base max-w-md mb-10 leading-relaxed">
        Trade business coaching — practical steps, tasks, and resources. Your chat history is saved automatically.
      </p>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
        {[
          'How do I improve cash flow during slow months?',
          'Help me write a job ad for a new apprentice',
          'What systems should I set up first?',
          "I'm losing money on projects — how do I fix pricing?",
        ].map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onChipClick(q)}
            className="group flex w-full items-start gap-2 rounded-2xl border border-black/[0.08] bg-[#fafafa] px-4 py-3.5 text-left text-sm text-ink-700 shadow-sm transition-colors hover:bg-[#f4f4f5] hover:border-black/[0.12]"
          >
            <ArrowRight
              size={14}
              className="mt-0.5 shrink-0 text-ink-400 group-hover:text-ink-600"
            />
            <span className="leading-snug">{q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end px-0.5">
      <div className="max-w-[min(100%,36rem)] rounded-[1.35rem] bg-[#ececf1] px-4 py-2.5 text-[15px] leading-relaxed text-ink-900">
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function AssistantMessage({
  message,
  onCopy,
  copiedId,
}: {
  message: ChatMessage;
  onCopy: (text: string, id: string) => void;
  copiedId: string | null;
}) {
  const { parsed } = message;
  const isStreaming = Boolean(message.streaming);
  const finishingStructured = Boolean(message.finishingStructured);
  const hasStructuredBlocks =
    Boolean(parsed?.rag_sources?.length) ||
    Boolean(parsed?.next_steps?.length) ||
    Boolean(parsed?.tasks?.length) ||
    Boolean(parsed?.resources?.length);

  return (
    <div className="flex gap-3 px-0.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[10px] font-bold text-white">
        TiB
      </div>
      <div className="min-w-0 flex-1 space-y-4 pt-0.5">
        <div>
          {message.streamStatus && !message.content && (
            <div className="flex items-center gap-2 text-ink-400 mb-2">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-sm">{message.streamStatus}</span>
            </div>
          )}
          {(message.content || !message.streamStatus) && (
            <p className="text-[15px] leading-relaxed text-ink-900 whitespace-pre-wrap">
              {message.content}
              {isStreaming && message.content && (
                <span className="inline-block w-0.5 h-4 ml-0.5 align-text-bottom bg-ink-400 animate-pulse" />
              )}
            </p>
          )}
        </div>

        {finishingStructured && !hasStructuredBlocks && (
          <div className="flex items-center gap-2 text-ink-400 text-sm py-1">
            <Loader2 size={14} className="animate-spin shrink-0" />
            <span>Adding next steps, tasks &amp; sources…</span>
          </div>
        )}

        {!isStreaming && !finishingStructured && parsed?.rag_sources && parsed.rag_sources.length > 0 && (
          <div className="rounded-2xl bg-amber-50/80 border border-amber-100 p-4">
            <div className="mb-3 flex items-center gap-2">
              <FileText size={14} className="text-amber-700" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                Knowledge base
              </h4>
            </div>
            <ul className="space-y-2">
              {dedupeRagSourcesForDisplay(parsed.rag_sources).map((src) => {
                const href = citationHrefFromSource(src);
                return (
                  <li key={src.chunk_id} className="text-sm text-amber-950">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-medium text-amber-900 underline decoration-amber-300 underline-offset-2 hover:decoration-amber-600 hover:text-amber-950"
                      >
                        {src.title}
                        <ExternalLink size={12} className="shrink-0 opacity-70" />
                      </a>
                    ) : (
                      <span className="font-medium">{src.title}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!isStreaming && !finishingStructured && parsed?.next_steps && parsed.next_steps.length > 0 && (
          <div className="rounded-2xl border border-black/[0.06] bg-[#fafafa] p-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
              Next steps
            </h4>
            <ol className="space-y-2.5">
              {parsed.next_steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm text-ink-700">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-xs font-semibold">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}

        {!isStreaming && !finishingStructured && parsed?.tasks && parsed.tasks.length > 0 && (
          <div className="rounded-2xl border border-teal-100 bg-teal-50/80 p-4">
            <div className="mb-3 flex items-center gap-2">
              <CheckSquare size={14} className="text-teal-600" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-teal-800">
                Tasks
              </h4>
            </div>
            <ul className="space-y-2">
              {parsed.tasks.map((task, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-teal-900">
                  <CheckSquare size={14} className="shrink-0 mt-0.5 text-teal-500" />
                  <div>
                    <span className="font-medium">{task.title}</span>
                    {task.description && (
                      <span className="text-teal-700"> — {task.description}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!isStreaming &&
          !finishingStructured &&
          parsed?.resources &&
          parsed.resources.length > 0 &&
          !(parsed?.rag_sources && parsed.rag_sources.length > 0) && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-400">
              More from TiB
            </h4>
            {parsed.resources.map((res, i) => {
              const Icon = resourceIcons[res.type] || BookOpen;
              return (
                <a
                  key={i}
                  href={res.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-xl border border-ink-100 bg-surface hover:border-brand-200 hover:shadow-sm transition-all group"
                >
                  <div className="w-8 h-8 rounded-lg bg-ink-50 group-hover:bg-brand-50 flex items-center justify-center shrink-0 transition-colors">
                    <Icon size={16} className="text-ink-400 group-hover:text-brand-500 transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-900">{res.title}</p>
                    <p className="text-xs text-ink-400 truncate">{res.description}</p>
                  </div>
                  <ExternalLink size={14} className="text-ink-300 shrink-0" />
                </a>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => onCopy(message.content, message.id)}
            className="flex items-center gap-1.5 text-xs text-ink-300 hover:text-ink-600 transition-colors"
          >
            {copiedId === message.id ? (
              <>
                <Check size={13} /> Copied
              </>
            ) : (
              <>
                <Copy size={13} /> Copy
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
