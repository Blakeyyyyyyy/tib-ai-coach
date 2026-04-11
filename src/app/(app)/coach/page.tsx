'use client';

import { useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { AIResponse, TaskFromAI } from '@/lib/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parsed?: AIResponse;
  created_at: string;
}

const resourceIcons: Record<string, typeof Video> = {
  video: Video,
  podcast: Radio,
  blog: BookOpen,
  tool: Wrench,
};

const topicChips = [
  'Cash Flow',
  'Team Management',
  'Project Planning',
  'Pricing',
  'Client Relations',
  'Systems',
];

export default function CoachPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveTasks = async (tasks: TaskFromAI[], convId: string) => {
    if (!userId || tasks.length === 0) return;
    const supabase = createClient();
    for (const task of tasks) {
      await supabase.from('tasks').insert({
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
      created_at: msg.created_at,
    });
  };

  const ensureConversation = async (): Promise<string> => {
    if (conversationId) return conversationId;
    if (!userId) throw new Error('No user');
    const supabase = createClient();
    const id = uuidv4();
    const now = new Date().toISOString();
    await supabase.from('conversations').insert({
      id,
      user_id: userId,
      title: input.slice(0, 60) || 'New Session',
      created_at: now,
      updated_at: now,
    });
    setConversationId(id);
    return id;
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    const convId = await ensureConversation();
    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    await saveMessage(userMsg, convId);
    try {
      const allMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.role === 'assistant' && m.parsed ? m.parsed.answer : m.content,
      }));
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages, conversationId: convId }),
      });
      if (!res.ok) throw new Error('Failed');
      const data: AIResponse = await res.json();
      const assistantMsg: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: data.answer,
        parsed: data,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      await saveMessage(assistantMsg, convId);
      if (data.tasks && data.tasks.length > 0) {
        await saveTasks(data.tasks, convId);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uuidv4(),
          role: 'assistant',
          content: "Sorry, I couldn't process that. Please try again.",
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

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] lg:h-screen bg-page">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-6">
        <div className="max-w-3xl mx-auto">
          {messages.length === 0 ? (
            <EmptyState onChipClick={handleChipClick} />
          ) : (
            <div className="space-y-6">
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
              {loading && (
                <div className="flex items-center gap-3 text-ink-400">
                  <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
                    <span className="text-white text-xs font-bold">TiB</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">Thinking...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-sidebar-border bg-surface px-4 lg:px-8 py-4">
        <div className="max-w-3xl mx-auto">
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {topicChips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => handleChipClick(chip)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-ink-50 text-ink-600 hover:bg-brand-50 hover:text-brand-600 border border-ink-100 hover:border-brand-200 transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask the Coach about your next strategy..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-ink-100 bg-page px-4 py-3 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 max-h-32 transition-colors"
              style={{ minHeight: '44px' }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="shrink-0 w-11 h-11 rounded-xl bg-brand-500 text-white flex items-center justify-center hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-md shadow-brand-500/20"
            >
              <Send size={18} />
            </button>
          </div>
          <p className="text-xs text-ink-300 mt-2 text-center">
            AI advice should be verified against local regulations.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onChipClick }: { onChipClick: (t: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-14 h-14 rounded-2xl bg-brand-500 flex items-center justify-center mb-5 shadow-lg shadow-brand-500/20">
        <span className="text-white font-bold text-xl">TiB</span>
      </div>
      <h2 className="text-2xl font-bold text-ink-900 mb-2">TiB AI Coach</h2>
      <p className="text-ink-400 max-w-md mb-8">
        Ask me anything about running your trade business. I'll give you practical advice, clear next steps, and actionable tasks.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        {[
          'How do I improve cash flow during slow months?',
          'Help me write a job ad for a new apprentice',
          'What systems should I set up first?',
          "I'm losing money on projects — how do I fix pricing?",
        ].map((q) => (
          <button
            key={q}
            onClick={() => onChipClick(q)}
            className="text-left p-4 rounded-xl border border-ink-100 bg-surface hover:border-brand-200 hover:shadow-sm transition-all text-sm text-ink-600 hover:text-ink-900"
          >
            <span className="flex items-center gap-2">
              <ArrowRight size={14} className="text-brand-500 shrink-0" />
              {q}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-ink-900 text-white rounded-2xl rounded-br-md px-5 py-3">
        <p className="text-sm whitespace-pre-wrap">{content}</p>
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

  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center mt-1">
        <span className="text-white text-xs font-bold">TiB</span>
      </div>
      <div className="flex-1 min-w-0 space-y-4">
        {parsed && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-50 text-brand-600 tracking-wide border border-brand-100">
            STRATEGIC ADVICE
          </span>
        )}

        <div className="rounded-2xl bg-surface border border-ink-100 px-5 py-4 shadow-sm">
          <p className="text-sm text-ink-800 whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>

        {parsed?.next_steps && parsed.next_steps.length > 0 && (
          <div className="rounded-xl bg-ink-50 border border-ink-100 p-4">
            <h4 className="text-xs font-semibold text-ink-400 uppercase tracking-wider mb-3">
              Immediate Next Steps
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

        {parsed?.tasks && parsed.tasks.length > 0 && (
          <div className="rounded-xl bg-teal-50 border border-teal-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckSquare size={14} className="text-teal-600" />
              <h4 className="text-xs font-semibold text-teal-700 uppercase tracking-wider">
                Tasks Created
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

        {parsed?.resources && parsed.resources.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-ink-400 uppercase tracking-wider">
              Recommended Resources
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
            onClick={() => onCopy(message.content, message.id)}
            className="flex items-center gap-1.5 text-xs text-ink-300 hover:text-ink-600 transition-colors"
          >
            {copiedId === message.id ? (
              <><Check size={13} /> Copied</>
            ) : (
              <><Copy size={13} /> Copy</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
