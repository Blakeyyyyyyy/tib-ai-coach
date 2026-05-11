'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { NewsPost } from '@/lib/types';
import { Newspaper, Loader2, ExternalLink } from 'lucide-react';

export default function NewsPage() {
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('news_posts')
        .select('*')
        .eq('is_published', true)
        .order('created_at', { ascending: false });
      setPosts(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  return (
    <div className="min-h-screen bg-page px-4 lg:px-8 py-8">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center shadow-sm">
              <Newspaper size={18} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-ink-900">News & Updates</h1>
          </div>
          <p className="text-ink-400 text-sm ml-12">
            The latest from Nicole and the Trade in Business team.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={28} className="animate-spin text-ink-300" />
          </div>
        ) : posts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {posts.map((post, i) => {
              const isExpanded = expanded === post.id;
              const isNew = i < 2;
              return (
                <div
                  key={post.id}
                  className="rounded-2xl border border-ink-100 bg-surface overflow-hidden hover:border-ink-200 hover:shadow-sm transition-all"
                >
                  {post.image_url && (
                    <img
                      src={post.image_url}
                      alt={post.title}
                      className="w-full h-48 object-cover"
                    />
                  )}
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1.5">
                          {isNew && (
                            <span className="text-xs font-semibold text-brand-600 bg-brand-50 border border-brand-100 px-2 py-0.5 rounded-full">
                              New
                            </span>
                          )}
                          <span className="text-xs text-ink-400">{formatDate(post.created_at)}</span>
                        </div>
                        <h2 className="text-base font-semibold text-ink-900 leading-snug">{post.title}</h2>
                      </div>
                    </div>

                    <div className={`text-sm text-ink-600 leading-relaxed ${!isExpanded ? 'line-clamp-3' : ''}`}>
                      {post.body}
                    </div>

                    {post.body.length > 200 && (
                      <button
                        onClick={() => setExpanded(isExpanded ? null : post.id)}
                        className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
                      >
                        {isExpanded ? 'Show less' : 'Read more'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* FOMO footer */}
        {!loading && posts.length > 0 && (
          <div className="mt-10 p-5 rounded-2xl bg-ink-900 text-white text-center">
            <p className="font-semibold mb-1">There&apos;s a lot more inside the full program</p>
            <p className="text-sm text-ink-300 mb-3">
              Program members get exclusive content, live coaching, templates, and direct access to Nicole.
            </p>
            <a
              href="https://tradeinbusiness.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-brand-400 hover:text-brand-300 transition-colors"
            >
              Find out more <ExternalLink size={13} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-24">
      <div className="w-14 h-14 rounded-2xl bg-ink-50 border border-ink-100 flex items-center justify-center mx-auto mb-4">
        <Newspaper size={24} className="text-ink-300" />
      </div>
      <h3 className="text-base font-semibold text-ink-700 mb-1">No posts yet</h3>
      <p className="text-sm text-ink-400">Nicole&apos;s team will be posting updates here soon.</p>
    </div>
  );
}
