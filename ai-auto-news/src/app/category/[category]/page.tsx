import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import { getPostsByCategory } from '@/db/posts';
import Link from 'next/link';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <Link href="/" className="text-sm text-blue-600 hover:text-blue-800">
          ← Back to all posts
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-4">
          {title === 'Blog' ? '📝' : '📰'} {title}
        </h1>
        <p className="text-gray-600 mt-2">
          {total} {total === 1 ? 'post' : 'posts'} in this category
        </p>
      </div>

      {posts.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500 text-lg">No {category} posts yet.</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        basePath={`/category/${category}`}
        category={category}
      />
    </div>
  );
}
