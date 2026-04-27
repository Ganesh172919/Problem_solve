import { NextRequest, NextResponse } from 'next/server';
import { getPostBySlug, getAllPosts } from '@/db/posts';
import { getPersonalizedRecommendations, getRecommendations, getTrendingTopics } from '@/agents/recommendationAgent';
import { cache } from '@/lib/cache';
import { APP_CONFIG } from '@/lib/config';

function csv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 30);
}

// GET /api/recommendations?slug=<slug> - related posts for a given post
// GET /api/recommendations?view=trending - trending tags
// GET /api/recommendations?view=personalized&topics=<csv>&categories=<csv>&exclude=<csv>
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug');
    const view = searchParams.get('view');
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') || '5', 10)));

    if (view === 'personalized') {
      const topics = csv(searchParams.get('topics'));
      const categories = csv(searchParams.get('categories'));
      const excludeSlugs = csv(searchParams.get('exclude'));
      const cacheKey = `personalized:${topics.join('|')}:${categories.join('|')}:${excludeSlugs.join('|')}:${limit}`;
      const recommendations = await cache.getOrSet(
        cacheKey,
        async () => {
          const { posts } = getAllPosts(1, 500);
          return getPersonalizedRecommendations({
            posts,
            topics,
            categories,
            excludeSlugs,
            limit,
          });
        },
        60,
      );

      return NextResponse.json({
        recommendations,
        filters: { topics, categories, exclude: excludeSlugs },
      });
    }

    if (view === 'trending') {
      const days = parseInt(searchParams.get('days') || '7', 10);
      const cacheKey = `trending:${days}:${limit}`;
      const result = await cache.getOrSet(
        cacheKey,
        async () => {
          const { posts } = getAllPosts(1, 500);
          return getTrendingTopics(posts, days, limit);
        },
        APP_CONFIG.cacheDefaultTtlSeconds,
      );
      return NextResponse.json({ trending: result, days });
    }

    if (!slug) {
      return NextResponse.json(
        { error: 'Provide either ?slug=<post-slug>, ?view=trending, or ?view=personalized' },
        { status: 400 },
      );
    }

    const post = getPostBySlug(slug);
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    const cacheKey = `recommendations:${slug}:${limit}`;
    const recommendations = await cache.getOrSet(
      cacheKey,
      async () => {
        const { posts } = getAllPosts(1, 500);
        return getRecommendations(post, posts, limit);
      },
      APP_CONFIG.cacheDefaultTtlSeconds,
    );

    return NextResponse.json({ recommendations, postSlug: slug });
  } catch (error) {
    console.error('Error in recommendations GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
