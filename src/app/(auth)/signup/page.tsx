'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) { setError(error.message); setLoading(false); return; }
    router.push('/dashboard');
    router.refresh();
  };

  const inputClass = "w-full rounded-xl border border-ink-100 bg-surface px-4 py-3 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 transition-colors";

  return (
    <div className="min-h-screen bg-page flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-5/12 bg-[#e2e8f0] items-center justify-center p-12">
        <div className="max-w-md">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">TiB</span>
            </div>
            <h1 className="text-ink-900 text-2xl font-semibold">TiB AI Coach</h1>
          </div>
          <h2 className="text-ink-900 text-3xl font-bold leading-tight mb-4">
            Start building a better trade business today.
          </h2>
          <p className="text-ink-500 text-lg leading-relaxed">
            Join trade business owners getting practical AI coaching, actionable tasks, and clear direction.
          </p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-10">
            <div className="w-9 h-9 bg-brand-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">TiB</span>
            </div>
            <h1 className="text-ink-900 text-xl font-semibold">TiB AI Coach</h1>
          </div>

          <h2 className="text-2xl font-bold text-ink-900 mb-1">Create your account</h2>
          <p className="text-ink-400 mb-8">Get started with your AI business coach</p>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">Full Name</label>
              <input type="text" placeholder="John Smith" value={fullName} onChange={(e) => setFullName(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">Email</label>
              <input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-700 mb-1.5">Password</label>
              <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className={inputClass} />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm disabled:opacity-50 transition-colors shadow-md shadow-brand-500/20"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-400">
            Already have an account?{' '}
            <Link href="/login" className="text-ink-900 font-semibold hover:text-brand-500 transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
