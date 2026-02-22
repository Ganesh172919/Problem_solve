import { NextRequest, NextResponse } from 'next/server';
import { moderateContent } from '@/lib/contentModerationEngine';
import type { ModerationRequest } from '@/lib/contentModerationEngine';

// POST /api/v1/moderate — Public API endpoint for content moderation
export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json({ error: 'API key required' }, { status: 401 });
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
      id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      contentId: body.contentId,
      contentType: body.contentType,
      text: body.text,
      authorId: body.authorId,
      tenantId: body.tenantId,
    };

    const result = await moderateContent(moderationRequest);

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
    console.error('v1/moderate error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
