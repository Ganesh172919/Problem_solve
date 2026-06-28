import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { moderateContent } from '@/lib/contentModerationEngine';
import type { ModerationRequest } from '@/lib/contentModerationEngine';
import { authenticateApiKey } from '@/lib/apiKeyAuth';
import { rateLimiter, buildRateLimitKey } from '@/lib/rateLimit';
import { trackUsageEvent } from '@/db/usage';
import { metrics } from '@/lib/metrics';
import { TIER_LIMITS } from '@/lib/config';
import { logger } from '@/lib/logger';

// POST /api/v1/moderate — Public API endpoint for content moderation
export async function POST(request: NextRequest) {
  const startMs = Date.now();
  const endpoint = '/api/v1/moderate';

  try {
    // Authenticate via API key (consistent with other v1 routes)
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
            'X-RateLimit-Limit': String(limits.apiCallsPerMinute),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rl.resetAt),
          },
        },
      );
    }

    const body = await request.json() as {
      contentId?: string;
      contentType?: ModerationRequest['contentType'];
      text?: string;
      authorId?: string;
      tenantId?: string;
    };

    if (!body.contentId || !body.text || !body.authorId || !body.contentType) {
      return NextResponse.json(
        { error: 'contentId, text, authorId, and contentType are required' },
        { status: 400 },
      );
    }

    const moderationRequest: ModerationRequest = {
      id: randomUUID(),
      contentId: body.contentId,
      contentType: body.contentType,
      text: body.text,
      authorId: body.authorId,
      tenantId: body.tenantId,
    };

    const result = await moderateContent(moderationRequest);

    // Track usage
    const durationMs = Date.now() - startMs;
    trackUsageEvent({
      userId: user.id,
      apiKeyId: apiKey.id,
      endpoint,
      method: 'POST',
      statusCode: 200,
      durationMs,
      tokensUsed: 0,
      tier,
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    });
    metrics.record('POST', endpoint, durationMs, false);

    return NextResponse.json({
      requestId: result.requestId,
      action: result.action,
      status: result.status,
      qualityScore: result.qualityScore,
      flags: result.scores.filter((s) => s.flagged).map((s) => ({ category: s.category, confidence: s.confidence })),
      reviewRequired: result.reviewRequired,
      processingMs: result.processingMs,
    });
  } catch (error) {
    const durationMs = Date.now() - startMs;
    logger.error('v1/moderate error', error instanceof Error ? error : undefined);
    metrics.record('POST', endpoint, durationMs, true);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
