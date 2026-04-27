import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import { getPostsByCategory } from '@/db/posts';
import Link from 'next/link';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

const CATEGORY_META: Record<string, { emoji: string; color: string; description: string }> = {
  blog: { emoji: '📝', color: '#60a5fa', description: 'In-depth articles and analysis on technology and AI' },
  news: { emoji: '📰', color: '#f87171', description: 'Breaking news and latest developments in tech' },
  tech: { emoji: '💻', color: '#22d3ee', description: 'Technical deep-dives and engineering insights' },
  business: { emoji: '📊', color: '#fbbf24', description: 'Business strategy and industry trends' },
  sports: { emoji: '🏆', color: '#34d399', description: 'Sports technology and innovation' },
  ai: { emoji: '🧠', color: '#c084fc', description: 'Artificial intelligence research and applications' },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const title = category.charAt(0).toUpperCase() + category.slice(1);
  return {
    title: `${title} — AI Auto News`,
    description: `Browse ${title} posts on AI Auto News`,
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { category } = await params;
  const sp = await searchParams;
  const page = parseInt(sp.page || '1', 10);
  const { posts, total } = getPostsByCategory(category, page, 10);
  const totalPages = Math.ceil(total / 10);

  const title = category.charAt(0).toUpperCase() + category.slice(1);
  const meta = CATEGORY_META[category] || { emoji: '📄', color: '#94a3b8', description: `Posts about ${title}` };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-10 animate-fade-in-up">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm mb-4 transition-colors"
          style={{ color: 'var(--text-accent)' }}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to all posts
        </Link>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-3xl">{meta.emoji}</span>
          <h1
            className="text-3xl font-bold"
            style={{ color: meta.color }}
          >
            {title}
          </h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          {meta.description}
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
          {total} {total === 1 ? 'article' : 'articles'}
        </p>
      </div>

      {posts.length === 0 ? (
        <div className="text-center py-20 animate-fade-in">
          <div className="text-5xl mb-4">{meta.emoji}</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
            No {category} posts yet.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '8px' }}>
            Check back soon — the AI generates content automatically!
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
