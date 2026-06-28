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
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <Link
          href="/"
          style={{ color: 'var(--color-accent)', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.75rem' }}
        >
          ← Back to all articles
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <span className={`category-badge category-badge-${category}`}>{meta.icon}</span>
          <h1 style={{ fontFamily: 'var(--font-headline)', fontSize: '2rem', fontWeight: 700 }}>{meta.label}</h1>
        </div>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.95rem' }}>{meta.description}</p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
          {total} {total === 1 ? 'article' : 'articles'}
        </p>
      </div>

      {posts.length === 0 ? (
        <div className="empty-state">
          <p>No {meta.label.toLowerCase()} articles yet.</p>
          <span>Check back soon. The AI publisher adds new coverage automatically.</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.25rem' }}>
          {posts.map((post, i) => (
            <PostCard key={post.id} post={post} index={i} />
          ))}
        </div>
      )}

      <Pagination currentPage={page} totalPages={totalPages} />
    </div>
  );
}
