'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { v4 as uuidv4 } from 'uuid';
import { Task } from '@/lib/types';
import {
  Plus,
  CheckCircle2,
  Circle,
  Trash2,
  Pencil,
  X,
  Check,
  Sparkles,
  ListChecks,
} from 'lucide-react';

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');

  useEffect(() => { loadTasks(); }, []);

  const loadTasks = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setTasks(data);
    setLoading(false);
  };

  const addTask = async () => {
    if (!newTitle.trim()) return;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const now = new Date().toISOString();
    const task: Task = {
      id: uuidv4(),
      user_id: user.id,
      title: newTitle.trim(),
      description: newDesc.trim() || null,
      status: 'pending',
      source: 'manual',
      conversation_id: null,
      created_at: now,
      updated_at: now,
    };
    await supabase.from('tasks').insert(task);
    setTasks([task, ...tasks]);
    setNewTitle('');
    setNewDesc('');
    setShowAdd(false);
  };

  const toggleTask = async (task: Task) => {
    const newStatus = task.status === 'pending' ? 'completed' : 'pending';
    const supabase = createClient();
    await supabase.from('tasks').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', task.id);
    setTasks(tasks.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t)));
  };

  const deleteTask = async (taskId: string) => {
    const supabase = createClient();
    await supabase.from('tasks').delete().eq('id', taskId);
    setTasks(tasks.filter((t) => t.id !== taskId));
  };

  const startEdit = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDesc(task.description || '');
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    const supabase = createClient();
    await supabase
      .from('tasks')
      .update({ title: editTitle.trim(), description: editDesc.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', editingId);
    setTasks(tasks.map((t) =>
      t.id === editingId ? { ...t, title: editTitle.trim(), description: editDesc.trim() || null } : t
    ));
    setEditingId(null);
  };

  const filtered = tasks.filter((t) => {
    if (filter === 'pending') return t.status === 'pending';
    if (filter === 'completed') return t.status === 'completed';
    return true;
  });

  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const completionPct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-page px-6 lg:px-10 py-10">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-ink-900">Action Plan</h1>
            <p className="text-ink-400 mt-1">Your high-impact tasks for the upcoming sprint.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-ink-100 rounded-full">
              <span className="text-xs font-medium text-ink-400">COMPLETION</span>
              <span className="text-sm font-bold text-ink-900">{completionPct}%</span>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors shadow-md shadow-brand-500/20"
            >
              <Plus size={16} /> Add Task
            </button>
          </div>
        </div>

        {/* Coach's Note */}
        {pendingCount > 0 && (
          <div className="rounded-xl bg-cg-800 border border-cg-700 p-4 mb-8">
            <span className="text-xs font-semibold text-brand-400 uppercase tracking-wider">Coach&apos;s Note</span>
            <p className="text-sm text-cg-100 mt-2 italic leading-relaxed">
              &ldquo;Focus on your {pendingCount} open task{pendingCount !== 1 ? 's' : ''}. Completing these will move your business forward this week.&rdquo;
            </p>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-1 mb-6 bg-ink-50 rounded-lg p-1 w-fit border border-ink-100">
          {(['all', 'pending', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                filter === f
                  ? 'bg-surface text-ink-900 shadow-sm border border-ink-100'
                  : 'text-ink-400 hover:text-ink-700'
              }`}
            >
              {f === 'all' ? `All (${tasks.length})` : f === 'pending' ? `Open (${pendingCount})` : `Done (${completedCount})`}
            </button>
          ))}
        </div>

        {/* Add Task Form */}
        {showAdd && (
          <div className="rounded-xl bg-surface border border-ink-100 shadow-sm p-4 mb-6">
            <h3 className="text-sm font-semibold text-ink-900 mb-3">New Task</h3>
            <div className="space-y-3">
              <input
                autoFocus
                placeholder="Task title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTask()}
                className="w-full rounded-lg border border-ink-100 bg-page px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 transition-colors"
              />
              <input
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full rounded-lg border border-ink-100 bg-page px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 transition-colors"
              />
              <div className="flex gap-2">
                <button
                  onClick={addTask}
                  disabled={!newTitle.trim()}
                  className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-40 transition-colors"
                >
                  Add Task
                </button>
                <button
                  onClick={() => { setShowAdd(false); setNewTitle(''); setNewDesc(''); }}
                  className="px-4 py-2 rounded-lg text-ink-500 hover:bg-ink-50 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Task List */}
        {loading ? (
          <div className="text-center py-12 text-ink-400">Loading tasks...</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl bg-surface border border-ink-100 p-12 text-center">
            <ListChecks size={40} className="mx-auto text-ink-200 mb-4" />
            <p className="text-ink-400 mb-1">
              {filter === 'all' ? 'No tasks yet' : filter === 'pending' ? 'No open tasks' : 'No completed tasks'}
            </p>
            <p className="text-ink-300 text-sm">
              {filter === 'all' && 'Start a coaching session or add a task manually.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((task) => (
              <div key={task.id} className="rounded-xl bg-surface border border-ink-100 hover:border-ink-200 hover:shadow-sm transition-all">
                {editingId === task.id ? (
                  <div className="p-4 space-y-3">
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full rounded-lg border border-ink-100 bg-page px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 transition-colors"
                    />
                    <input
                      placeholder="Description (optional)"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full rounded-lg border border-ink-100 bg-page px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 transition-colors"
                    />
                    <div className="flex gap-2">
                      <button onClick={saveEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors">
                        <Check size={14} /> Save
                      </button>
                      <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg text-ink-500 hover:bg-ink-50 text-sm transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 p-4 group">
                    <button onClick={() => toggleTask(task)} className="mt-0.5 shrink-0">
                      {task.status === 'completed' ? (
                        <CheckCircle2 size={20} className="text-teal-500" />
                      ) : (
                        <Circle size={20} className="text-ink-300 hover:text-brand-500 transition-colors" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${task.status === 'completed' ? 'text-ink-300 line-through' : 'text-ink-900'}`}>
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-xs text-ink-400 mt-0.5">{task.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2">
                        {task.source === 'ai' && (
                          <span className="inline-flex items-center gap-1 text-xs bg-brand-50 text-brand-500 px-2 py-0.5 rounded-full font-medium border border-brand-100">
                            <Sparkles size={10} /> AI Generated
                          </span>
                        )}
                        <span className="text-xs text-ink-300">{new Date(task.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(task)}
                        className="p-1.5 rounded-md hover:bg-ink-50 text-ink-300 hover:text-ink-600 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="p-1.5 rounded-md hover:bg-red-50 text-ink-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
