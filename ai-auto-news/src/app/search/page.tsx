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
  // Escape query words so they cannot introduce HTML
  const highlighted = safeText.replace(
    pattern,
    '<mark class="bg-yellow-200 rounded px-0.5">$1</mark>',
  );

  // Sanitize to ensure no injected HTML survives
  return DOMPurify.sanitize(highlighted, {
    ALLOWED_TAGS: ['mark'],
    ALLOWED_ATTR: ['class'],
  });
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

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {/* Search header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Search Articles</h1>
        <p className="text-gray-500 text-sm">
          Full-text search across all AI Auto News articles.
        </p>
      </div>

      {/* Search input */}
      <div className="relative mb-8">
        <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
          <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          className="w-full rounded-xl border border-gray-300 bg-white pl-12 pr-4 py-3 text-gray-900 shadow-sm placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        {loading && (
          <div className="absolute inset-y-0 right-4 flex items-center">
            <svg className="h-5 w-5 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            {result.total === 0
              ? `No results for "${result.query}"`
              : `${result.total.toLocaleString()} result${result.total !== 1 ? 's' : ''} for "${result.query}"`}
          </p>

          <div className="space-y-4">
            {result.posts.map((post) => (
              <article
                key={post.id}
                className="rounded-xl border border-gray-200 bg-white p-5 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                  <span className="capitalize rounded bg-gray-100 px-2 py-0.5 text-gray-600">
                    {post.category}
                  </span>
                  <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                </div>

                <Link href={`/post/${post.slug}`} className="group">
                  <h2
                    className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 mb-1"
                    dangerouslySetInnerHTML={{
                      __html: highlightQuery(post.title, result.query),
                    }}
                  />
                  <p
                    className="text-sm text-gray-500 line-clamp-2"
                    dangerouslySetInnerHTML={{
                      __html: highlightQuery(post.summary, result.query),
                    }}
                  />
                </Link>

                {post.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {post.tags.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
                      >
                        {tag}
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
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="flex items-center px-4 text-sm text-gray-600">
                Page {result.page} of {result.totalPages}
              </span>
              <button
                disabled={result.page >= result.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!query && !result && (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="text-gray-400 text-sm">Type to start searching…</p>
        </div>
      )}

      {result && result.total === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm mb-4">Try different keywords or browse by category.</p>
          <div className="flex justify-center gap-3">
            <Link href="/category/blog" className="text-sm text-blue-600 hover:underline">Browse Blog</Link>
            <Link href="/category/news" className="text-sm text-blue-600 hover:underline">Browse News</Link>
          </div>
        </div>
      )}
    </div>
  );
}
