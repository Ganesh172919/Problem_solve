import PersonalizedHome from '@/components/PersonalizedHome';
import { getAllPosts, getCategories, getPostStats } from '@/db/posts';
import { initializeScheduler } from '@/lib/scheduler-init';

initializeScheduler();

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || '1', 10);
  const { posts: latestPosts, total } = getAllPosts(page, 12);
  const { posts: allPosts } = getAllPosts(1, 200);
  const totalPages = Math.ceil(total / 12);
  const categories = getCategories();
  const stats = getPostStats();

  return (
    <PersonalizedHome
      latestPosts={latestPosts}
      allPosts={allPosts}
      categories={categories}
      stats={stats}
      currentPage={page}
      totalPages={totalPages}
    />
  );
}
