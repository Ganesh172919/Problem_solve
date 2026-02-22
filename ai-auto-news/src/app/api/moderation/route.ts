import { NextRequest, NextResponse } from 'next/server';
import { moderateContent, getModerationResult, getReviewQueue, getModerationAnalytics } from '@/lib/contentModerationEngine';
import type { ModerationRequest } from '@/lib/contentModerationEngine';

// POST /api/moderation — Submit content for moderation
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<ModerationRequest>;

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
      metadata: body.metadata,
    };

    const result = await moderateContent(moderationRequest);

    return NextResponse.json({ result }, { status: 200 });
  } catch (error) {
    console.error('Moderation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/moderation?requestId=<id>&view=queue|analytics
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view');
    const requestId = searchParams.get('requestId');

    if (requestId) {
      const result = getModerationResult(requestId);
      if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ result });
    }

    if (view === 'queue') {
      const queue = getReviewQueue({ limit: 50 });
      return NextResponse.json({ queue, count: queue.length });
    }

    if (view === 'analytics') {
      const days = parseInt(searchParams.get('days') ?? '7', 10);
      const analytics = getModerationAnalytics(undefined, days);
      return NextResponse.json({ analytics });
    }

    return NextResponse.json({ error: 'Specify requestId or view=queue|analytics' }, { status: 400 });
  } catch (error) {
    console.error('Moderation GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
