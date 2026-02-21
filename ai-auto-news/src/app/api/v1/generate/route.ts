import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiKey, hasScope } from '@/lib/apiKeyAuth';
import { rateLimiter, buildRateLimitKey } from '@/lib/rateLimit';
import { trackUsageEvent } from '@/db/usage';
import { metrics } from '@/lib/metrics';
import { TIER_LIMITS } from '@/lib/config';
import { canGenerateContent } from '@/lib/featureGate';
import { orchestrate } from '@/agents/agentOrchestrator';

export async function POST(request: NextRequest) {
  const startMs = Date.now();
  const endpoint = '/api/v1/generate';

  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const { user, apiKey } = authResult;
  const tier = user.tier;

  // Feature gate: only pro and enterprise can generate via API
  if (!canGenerateContent(tier)) {
    return NextResponse.json(
      { error: 'Content generation requires a Pro or Enterprise subscription', tier },
      { status: 403 },
    );
  }

  // Check write scope
  if (!hasScope(apiKey, 'generate')) {
    return NextResponse.json(
      { error: 'API key does not have the "generate" scope' },
      { status: 403 },
    );
  }

  // Per-minute rate limit (tighter for generation — expensive endpoint)
  const limits = TIER_LIMITS[tier];
  const rateLimitKey = buildRateLimitKey('generate', user.id);
  const rl = rateLimiter.check(rateLimitKey, Math.floor(limits.apiCallsPerMinute / 10), 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded for content generation', resetAt: new Date(rl.resetAt).toISOString() },
      { status: 429 },
    );
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // empty body is fine
    }

    const category = body.category as 'blog' | 'news' | undefined;
    const topic = body.topic as string | undefined;

    const result = await orchestrate({ type: 'publish_content', category, topic });

    const durationMs = Date.now() - startMs;
    const success = result.success;
    metrics.record('POST', endpoint, durationMs, !success);

    trackUsageEvent({
      userId: user.id,
      apiKeyId: apiKey.id,
      endpoint,
      method: 'POST',
      statusCode: success ? 200 : 500,
      durationMs,
      tokensUsed: 1,
      tier,
      ipAddress: request.headers.get('x-forwarded-for') || '',
    });

    if (!success) {
      return NextResponse.json({ error: result.error || 'Generation failed' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      durationMs: result.durationMs,
      steps: result.steps.map((s) => ({ name: s.name, status: s.status, durationMs: s.durationMs })),
      post: result.output.post,
    });
  } catch (error) {
    const durationMs = Date.now() - startMs;
    metrics.record('POST', endpoint, durationMs, true);
    console.error('Error in v1/generate POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
