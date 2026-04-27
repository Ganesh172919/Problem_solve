import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import { getPostsByCategory } from '@/db/posts';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getCategoryMeta } from '@/lib/postPresentation';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const meta = getCategoryMeta(category);
  return {
    title: meta.label,
    description: meta.description,
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
  const { posts, total } = getPostsByCategory(category, page, 12);
  const totalPages = Math.ceil(total / 12);
  const meta = getCategoryMeta(category);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
          <span className="badge" style={{ color: meta.color, background: 'rgba(255,255,255,0.05)' }}>
            {meta.icon}
          </span>
          <h1 className="text-3xl font-bold" style={{ color: meta.color }}>
            {meta.label}
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
        <div className="empty-state animate-fade-in">
          <p>No {meta.label.toLowerCase()} posts yet.</p>
          <span>Check back soon. The AI publisher adds new coverage automatically.</span>
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
