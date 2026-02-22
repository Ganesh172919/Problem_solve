import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getUserEngagementEngine from '../../../../lib/userEngagementEngine';

const logger = getLogger();
const cache = getCache();

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const cacheKey = `engagement:${userId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }

    const engine = getUserEngagementEngine();
    const data = engine.getUserEngagementSummary(userId);

    cache.set(cacheKey, data, 60);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    logger.error('Engagement GET error', { error });
    return NextResponse.json({ error: 'Failed to retrieve engagement data' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { userId, events } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (!events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: 'events must be a non-empty array' },
        { status: 400 }
      );
    }

    const VALID_EVENT_TYPES = ['view', 'click', 'share', 'comment', 'purchase'];
    for (const event of events) {
      if (!event.type || !VALID_EVENT_TYPES.includes(event.type)) {
        return NextResponse.json(
          { error: `Each event must have a type of: ${VALID_EVENT_TYPES.join(', ')}` },
          { status: 400 }
        );
      }
    }

    const engine = getUserEngagementEngine();
    for (const event of events) {
      engine.recordAction(userId, event.type, event.value);
    }
    const result = engine.getUserEngagementSummary(userId);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error('Engagement POST error', { error });
    return NextResponse.json({ error: 'Failed to process engagement events' }, { status: 500 });
  }
}
