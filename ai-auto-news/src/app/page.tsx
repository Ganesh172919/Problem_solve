import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import { getAllPosts, getCategories, getPostStats } from '@/db/posts';
import { initializeScheduler } from '@/lib/scheduler-init';
import Link from 'next/link';

// Initialize the auto-publisher scheduler on server start
initializeScheduler();

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || '1', 10);
  const { posts, total } = getAllPosts(page, 10);
  const totalPages = Math.ceil(total / 10);
  const categories = getCategories();
  const stats = getPostStats();

  // Get the latest 5 news articles for the "Daily Headlines" ticker
  const latestNews = posts.filter((p) => p.category === 'news').slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ---- Hero Section ---- */}
      <div className="text-center mb-12 animate-fade-in-up">
        <div className="flex items-center justify-center gap-2 mb-4">
          <span className="pulse-dot" />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
            Auto-Publishing Active
          </span>
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold mb-4 gradient-text-animate leading-tight">
          AI Auto News
        </h1>
        <p
          className="text-lg max-w-2xl mx-auto mb-8"
          style={{ color: 'var(--text-secondary)', lineHeight: '1.7' }}
        >
          An autonomous AI-powered publishing platform that researches trending topics,
          generates content, and publishes automatically.
        </p>

        {/* Quick Actions */}
        <div className="flex items-center justify-center gap-3">
          <Link href="/search" className="btn-primary">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Search Articles
          </Link>
          <Link href="/api/export?format=json" className="btn-ghost" target="_blank">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </Link>
        </div>
      </div>

      {/* ---- Stats Bar ---- */}
      <div
        className="grid grid-cols-3 gap-4 mb-10 animate-fade-in-up"
        style={{ animationDelay: '0.15s', animationFillMode: 'forwards', opacity: 0 }}
      >
        <div className="stat-card text-center">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Posts</div>
        </div>
        <div className="stat-card text-center">
          <div className="stat-value">{stats.autoCount}</div>
          <div className="stat-label">AI Generated</div>
        </div>
        <div className="stat-card text-center">
          <div className="stat-value">
            {stats.lastGeneration
              ? timeAgo(stats.lastGeneration)
              : '—'}
          </div>
          <div className="stat-label">Last Published</div>
        </div>
      </div>

      {/* ---- Daily Headlines Ticker (if news exist) ---- */}
      {latestNews.length > 0 && (
        <div
          className="glass mb-10 p-5 animate-fade-in-up"
          style={{
            borderRadius: 'var(--radius-lg)',
            animationDelay: '0.25s',
            animationFillMode: 'forwards',
            opacity: 0,
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span style={{ fontSize: '0.8rem' }}>📰</span>
            <h2 style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.9rem' }}>
              Daily Headlines
            </h2>
          </div>
          <div className="space-y-2">
            {latestNews.map((article) => (
              <Link
                key={article.id}
                href={`/post/${article.slug}`}
                className="flex items-center gap-3 py-2 px-3 rounded-lg transition-colors"
                style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}
              >
                <span style={{ color: 'var(--text-accent)', fontWeight: 600, flexShrink: 0 }}>→</span>
                <span className="line-clamp-1">{article.title}</span>
                <time
                  className="ml-auto flex-shrink-0"
                  style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}
                >
                  {new Date(article.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </time>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ---- Category Filters ---- */}
      {categories.length > 0 && (
        <div
          className="flex flex-wrap gap-2 mb-8 justify-center animate-fade-in-up"
          style={{ animationDelay: '0.3s', animationFillMode: 'forwards', opacity: 0 }}
        >
          <Link href="/" className="category-pill active">
            All
          </Link>
          {categories.map((cat) => (
            <Link
              key={cat}
              href={`/category/${cat}`}
              className="category-pill"
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </Link>
          ))}
        </div>
      )}

      {/* ---- Posts Grid ---- */}
      {posts.length === 0 ? (
        <div className="text-center py-20 animate-fade-in">
          <div className="text-5xl mb-4 animate-float">🤖</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
            No posts yet.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '8px' }}>
            The AI will automatically generate content shortly. Check back in a few minutes!
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, i) => (
            <PostCard key={post.id} post={post} index={i} />
          ))}
        </div>
      )}

      <Pagination currentPage={page} totalPages={totalPages} />
    </div>
  );
}

/** Simple relative time helper */
function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
