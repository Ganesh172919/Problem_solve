import { NextRequest, NextResponse } from 'next/server';
import { searchPosts } from '@/db/posts';
import { cache } from '@/lib/cache';
import { checkIpRateLimit, extractClientIp } from '@/lib/abuseDetection';

// GET /api/search?q=<query>&page=<n>&limit=<n>  — public full-text post search
export async function GET(request: NextRequest) {
  // IP rate limiting for the public search endpoint
  const ip = extractClientIp(
    request.headers.get('x-forwarded-for'),
    request.headers.get('x-real-ip'),
  );
  const ipCheck = checkIpRateLimit(ip);
  if (ipCheck.blocked) {
    return NextResponse.json({ error: ipCheck.reason }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim().substring(0, 200);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));

  if (!query) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  const cacheKey = `search:${query}:${page}:${limit}`;
  const result = await cache.getOrSet(
    cacheKey,
    async () => searchPosts(query, page, limit),
    30,
  );

  return NextResponse.json({
    query,
    ...result,
    page,
    totalPages: Math.ceil(result.total / limit),
  });
}
