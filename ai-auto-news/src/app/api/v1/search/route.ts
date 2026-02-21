import { NextRequest, NextResponse } from 'next/server';
import { searchPosts } from '@/db/posts';
import { authenticateApiKey } from '@/lib/apiKeyAuth';
import { rateLimiter, buildRateLimitKey } from '@/lib/rateLimit';
import { trackUsageEvent } from '@/db/usage';
import { metrics } from '@/lib/metrics';
import { TIER_LIMITS } from '@/lib/config';
import { cache } from '@/lib/cache';

// GET /api/v1/search?q=<query>&page=<n>&limit=<n>  — API-key-authenticated full-text search
export async function GET(request: NextRequest) {
  const startMs = Date.now();
  const endpoint = '/api/v1/search';

  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user, apiKey } = authResult;
  const tier = user.tier;
  const limits = TIER_LIMITS[tier];

  // Per-minute rate limit
  const rateLimitKey = buildRateLimitKey('api_v1', user.id);
  const rl = rateLimiter.check(rateLimitKey, limits.apiCallsPerMinute, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', resetAt: new Date(rl.resetAt).toISOString() },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(rl.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(rl.resetAt).toISOString(),
        },
      },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get('q') || '').trim().substring(0, 200);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));

    if (!query) {
      return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
    }

    const cacheKey = `v1:search:${query}:${page}:${limit}`;
    const result = await cache.getOrSet(
      cacheKey,
      async () => searchPosts(query, page, limit),
      30,
    );

    const durationMs = Date.now() - startMs;
    metrics.record('GET', endpoint, durationMs, false);

    trackUsageEvent({
      userId: user.id,
      apiKeyId: apiKey.id,
      endpoint,
      method: 'GET',
      statusCode: 200,
      durationMs,
      tokensUsed: 0,
      tier,
      ipAddress: request.headers.get('x-forwarded-for') || '',
    });

    return NextResponse.json(
      {
        query,
        ...result,
        page,
        totalPages: Math.ceil(result.total / limit),
      },
      {
        headers: {
          'X-RateLimit-Limit': String(rl.limit),
          'X-RateLimit-Remaining': String(rl.remaining),
          'X-RateLimit-Reset': new Date(rl.resetAt).toISOString(),
        },
      },
    );
  } catch (error) {
    const durationMs = Date.now() - startMs;
    metrics.record('GET', endpoint, durationMs, true);
    console.error('Error in v1/search GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
