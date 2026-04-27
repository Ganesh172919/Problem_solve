'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import DOMPurify from 'isomorphic-dompurify';

interface SearchPost {
  id: string;
  title: string;
  slug: string;
  summary: string;
  category: string;
  tags: string[];
  createdAt: string;
}

interface SearchResult {
  query: string;
  posts: SearchPost[];
  total: number;
  page: number;
  totalPages: number;
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightQuery(text: string, query: string): string {
  const safeText = escapeHtml(text);
  if (!query.trim()) return safeText;

  const words = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (words.length === 0) return safeText;

  const pattern = new RegExp(`(${words.join('|')})`, 'gi');
  const highlighted = safeText.replace(
    pattern,
    '<mark style="background: rgba(168, 85, 247, 0.3); color: var(--text-primary); border-radius: 2px; padding: 0 2px;">$1</mark>',
  );

  return DOMPurify.sanitize(highlighted, {
    ALLOWED_TAGS: ['mark'],
    ALLOWED_ATTR: ['style'],
  });
}

function getCategoryBadgeClass(category: string): string {
  const map: Record<string, string> = {
    blog: 'badge-blog',
    news: 'badge-news',
    tech: 'badge-tech',
    business: 'badge-business',
    sports: 'badge-sports',
    ai: 'badge-ai',
  };
  return map[category] || 'badge-blog';
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 350);

  const doSearch = useCallback(async (q: string, p: number) => {
    if (!q.trim()) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}&page=${p}&limit=10`,
      );
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Search failed');
        setResult(null);
      } else {
        const data: SearchResult = await res.json();
        setResult(data);
      }
    } catch {
      setError('Search request failed. Please try again.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    doSearch(debouncedQuery, 1);
  }, [debouncedQuery, doSearch]);

  useEffect(() => {
    if (page > 1) {
      doSearch(debouncedQuery, page);
    }
  }, [page, debouncedQuery, doSearch]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {/* Search header */}
      <div className="mb-8 animate-fade-in-up">
        <h1 className="text-3xl font-bold mb-2 gradient-text">Search Articles</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Full-text search across all AI Auto News articles.
        </p>
      </div>

      {/* Search input */}
      <div className="relative mb-8 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
        <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
          <svg className="h-5 w-5" style={{ color: 'var(--text-muted)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search articles, topics, summaries…"
          className="search-input"
          style={{ paddingLeft: '48px' }}
        />
        {loading && (
          <div className="absolute inset-y-0 right-4 flex items-center">
            <svg className="h-5 w-5 animate-spin" style={{ color: 'var(--text-accent)' }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          className="mb-6 rounded-lg p-4 text-sm"
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: '#f87171',
          }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            {result.total === 0
              ? `No results for "${result.query}"`
              : `${result.total.toLocaleString()} result${result.total !== 1 ? 's' : ''} for "${result.query}"`}
          </p>

          <div className="space-y-3">
            {result.posts.map((post, i) => (
              <article
                key={post.id}
                className="card p-5 animate-fade-in-up"
                style={{ animationDelay: `${i * 0.05}s`, opacity: 0, animationFillMode: 'forwards' }}
              >
                <div className="flex items-center gap-2 text-xs mb-2">
                  <span className={`badge ${getCategoryBadgeClass(post.category)}`} style={{ fontSize: '0.7rem' }}>
                    {post.category}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {new Date(post.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <Link href={`/post/${post.slug}`} className="group">
                  <h2
                    className="text-lg font-semibold mb-1 transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                    dangerouslySetInnerHTML={{
                      __html: highlightQuery(post.title, result.query),
                    }}
                  />
                  <p
                    className="text-sm line-clamp-2"
                    style={{ color: 'var(--text-secondary)' }}
                    dangerouslySetInnerHTML={{
                      __html: highlightQuery(post.summary, result.query),
                    }}
                  />
                </Link>

                {post.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {post.tags.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded text-xs"
                        style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontSize: '0.7rem' }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>

          {/* Pagination */}
          {result.totalPages > 1 && (
            <div className="mt-8 flex justify-center gap-2">
              <button
                disabled={result.page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="btn-ghost disabled:opacity-40"
                style={{ padding: '6px 16px', fontSize: '0.8rem' }}
              >
                Previous
              </button>
              <span className="flex items-center px-4 text-sm" style={{ color: 'var(--text-muted)' }}>
                Page {result.page} of {result.totalPages}
              </span>
              <button
                disabled={result.page >= result.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="btn-ghost disabled:opacity-40"
                style={{ padding: '6px 16px', fontSize: '0.8rem' }}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!query && !result && (
        <div className="text-center py-16 animate-fade-in">
          <svg
            className="mx-auto h-16 w-16 mb-4"
            style={{ color: 'var(--text-muted)', opacity: 0.3 }}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Type to start searching…
          </p>
        </div>
      )}

      {result && result.total === 0 && (
        <div className="text-center py-12">
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Try different keywords or browse by category.
          </p>
          <div className="flex justify-center gap-3">
            <Link href="/category/blog" className="btn-ghost" style={{ fontSize: '0.8rem' }}>Browse Blog</Link>
            <Link href="/category/news" className="btn-ghost" style={{ fontSize: '0.8rem' }}>Browse News</Link>
          </div>
        </div>
      )}
    </div>
  );
}
