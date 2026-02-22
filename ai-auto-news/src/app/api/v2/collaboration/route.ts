import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getRealtimeCollaborationEngine from '../../../../lib/realtimeCollaborationEngine';

const logger = getLogger();
const cache = getCache();

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const sessionId = searchParams.get('sessionId');

    const cacheKey = `collaboration:${sessionId ?? 'all'}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }

    const engine = await getRealtimeCollaborationEngine();
    const data = sessionId
      ? await engine.getSession(sessionId)
      : await engine.listActiveSessions();

    await cache.set(cacheKey, data, 15);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    logger.error('Collaboration GET error', { error });
    return NextResponse.json({ error: 'Failed to retrieve collaboration sessions' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { action, sessionId, contentId, userId, operation, comment } = body;

    const VALID_ACTIONS = ['create', 'join', 'leave', 'operation', 'comment'];
    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action is required and must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 }
      );
    }

    if (action === 'create' && !contentId) {
      return NextResponse.json({ error: 'contentId is required for create action' }, { status: 400 });
    }

    if (['join', 'leave', 'operation', 'comment'].includes(action) && !sessionId) {
      return NextResponse.json({ error: 'sessionId is required for this action' }, { status: 400 });
    }

    const engine = await getRealtimeCollaborationEngine();
    const result = await engine.handleAction({
      action,
      sessionId,
      contentId,
      userId,
      operation,
      comment,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error('Collaboration POST error', { error });
    return NextResponse.json({ error: 'Failed to handle collaboration action' }, { status: 500 });
  }
}
