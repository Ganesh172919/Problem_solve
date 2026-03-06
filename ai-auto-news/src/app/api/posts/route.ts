import { NextRequest, NextResponse } from 'next/server';
import { getAllPosts, getPostsByCategory, getCategories } from '@/db/posts';
import { initializeScheduler } from '@/lib/scheduler-init';

export async function GET(request: NextRequest) {
  try {
    // Start background services on first runtime request (never during build/tests).
    initializeScheduler();

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const category = searchParams.get('category');

    const result = category
      ? getPostsByCategory(category, page, limit)
      : getAllPosts(page, limit);

    const categories = getCategories();

    return NextResponse.json({
      ...result,
      categories,
      page,
      totalPages: Math.ceil(result.total / limit),
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
  }
}
