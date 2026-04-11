'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Task } from '@/lib/types';
import {
  DollarSign,
  Users,
  TrendingUp,
  Wrench,
  Clock,
  ArrowRight,
  CheckCircle2,
  MessageSquare,
  Zap,
} from 'lucide-react';

const quickPrompts = [
  { label: 'Cash Flow', icon: DollarSign, prompt: 'Help me improve my cash flow management' },
  { label: 'Team', icon: Users, prompt: 'I need help managing my team better' },
  { label: 'Pricing', icon: TrendingUp, prompt: 'How should I price my services?' },
  { label: 'Systems', icon: Wrench, prompt: 'Help me set up better business systems' },
  { label: 'Time', icon: Clock, prompt: 'I need to manage my time more effectively' },
  { label: 'Growth', icon: Zap, prompt: 'How do I grow my trade business?' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [userName, setUserName] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserName(user.user_metadata?.full_name?.split(' ')[0] || '');
        const { data: taskData } = await supabase
          .from('tasks')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(4);
        if (taskData) setTasks(taskData);
      }
      setLoading(false);
    }
    load();
  }, []);

  const handlePromptClick = (prompt: string) => {
    sessionStorage.setItem('coach_prompt', prompt);
    router.push('/coach');
  };

  const handleCompleteTask = async (taskId: string) => {
    const supabase = createClient();
    await supabase
      .from('tasks')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', taskId);
    setTasks(tasks.filter((t) => t.id !== taskId));
  };

  return (
    <div className="min-h-screen bg-page px-6 lg:px-10 py-10">
      <div className="max-w-5xl mx-auto">

        {/* Hero */}
        <div className="mb-10">
          <h1 className="text-3xl lg:text-4xl font-bold text-ink-900 mb-2">
            {loading
              ? 'Loading...'
              : `What do you need help with today${userName ? `, ${userName}` : ''}?`}
          </h1>
          <p className="text-ink-400 text-lg">Your AI Trade Leadership Portal</p>
        </div>

        {/* Coaching Session CTA — green card */}
        <div className="mb-8 rounded-2xl bg-cg-800 border border-cg-700 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/20 text-brand-400 tracking-wide">
                LIVE SESSION
              </span>
            </div>
            <h2 className="text-xl font-semibold text-white mb-1.5">
              Ready to optimise your business performance?
            </h2>
            <p className="text-cg-200/70 text-sm max-w-md">
              Your AI coach is ready to analyse your current challenges and build a clear action plan.
            </p>
          </div>
          <button
            onClick={() => router.push('/coach')}
            className="shrink-0 flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm transition-all duration-150 shadow-md shadow-brand-500/20 whitespace-nowrap"
          >
            Start Coaching Session
            <ArrowRight size={16} />
          </button>
        </div>

        {/* Quick Prompts */}
        <div className="mb-10">
          <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-widest mb-4">
            Quick Guide Prompts
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {quickPrompts.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={() => handlePromptClick(item.prompt)}
                  className="flex flex-col items-center gap-2 p-4 bg-surface rounded-xl border border-ink-100 hover:border-brand-200 hover:shadow-sm transition-all duration-150 group"
                >
                  <div className="w-9 h-9 rounded-lg bg-ink-50 group-hover:bg-brand-50 flex items-center justify-center transition-colors">
                    <Icon size={18} className="text-ink-500 group-hover:text-brand-500 transition-colors" />
                  </div>
                  <span className="text-xs font-medium text-ink-600 group-hover:text-ink-900 transition-colors">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Plan */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-widest">
              Your Action Plan
            </h3>
            <button
              onClick={() => router.push('/tasks')}
              className="text-sm text-ink-400 hover:text-brand-500 font-medium flex items-center gap-1 transition-colors"
            >
              View All <ArrowRight size={14} />
            </button>
          </div>

          {tasks.length === 0 && !loading ? (
            <div className="rounded-xl border border-ink-100 bg-surface p-8 text-center">
              <MessageSquare size={32} className="mx-auto text-ink-200 mb-3" />
              <p className="text-ink-400 text-sm mb-3">No open tasks yet</p>
              <button
                onClick={() => router.push('/coach')}
                className="text-sm text-brand-500 hover:text-brand-600 font-medium transition-colors"
              >
                Start a coaching session to generate tasks
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-3 p-4 rounded-xl bg-surface border border-ink-100 hover:border-ink-200 hover:shadow-sm transition-all group"
                >
                  <button
                    onClick={() => handleCompleteTask(task.id)}
                    className="mt-0.5 shrink-0 w-5 h-5 rounded border-2 border-ink-300 hover:border-teal-500 hover:bg-teal-50 transition-colors"
                  >
                    <CheckCircle2 size={12} className="text-transparent group-hover:text-teal-500 mx-auto" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-900">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-ink-400 mt-0.5 truncate">{task.description}</p>
                    )}
                  </div>
                  {task.source === 'ai' && (
                    <span className="shrink-0 text-xs bg-ink-50 text-ink-400 px-2 py-0.5 rounded-full font-medium">
                      AI
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
