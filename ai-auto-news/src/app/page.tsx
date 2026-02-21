import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import { getAllPosts, getCategories } from '@/db/posts';
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Hero section */}
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-3">
          🤖 AI Auto News
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          An autonomous AI-powered publishing platform that researches trending topics,
          generates content, and publishes automatically every 5 minutes.
        </p>
      </div>

      {/* Category filters */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-8 justify-center">
          <Link
            href="/"
            className="rounded-full bg-gray-900 px-4 py-1.5 text-sm font-medium text-white"
          >
            All
          </Link>
          {categories.map((cat) => (
            <Link
              key={cat}
              href={`/category/${cat}`}
              className="rounded-full border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </Link>
          ))}
        </div>
      )}

      {/* Posts grid */}
      {posts.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500 text-lg">No posts yet.</p>
          <p className="text-gray-400 text-sm mt-2">
            The AI will automatically generate content shortly. Check back in a few minutes!
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      <Pagination currentPage={page} totalPages={totalPages} />
    </div>
  );
}
