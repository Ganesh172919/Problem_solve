import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getUserBehaviorAnalytics from '../../../../lib/userBehaviorAnalytics';

const logger = getLogger();
const cache = getCache();

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const userId = searchParams.get('userId');
    const sessionId = searchParams.get('sessionId');
    const segment = searchParams.get('segment');

    const cacheKey = `behavior:${userId ?? ''}:${sessionId ?? ''}:${segment ?? ''}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }

    const analytics = await getUserBehaviorAnalytics();
    const data = await analytics.getAnalytics({ userId, sessionId, segment });

    await cache.set(cacheKey, data, 60);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    logger.error('Behavior GET error', { error });
    return NextResponse.json({ error: 'Failed to retrieve behavior analytics' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { userId, sessionId, events } = body;

    if (!userId || !sessionId) {
      return NextResponse.json(
        { error: 'userId and sessionId are required' },
        { status: 400 }
      );
    }

    if (!events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: 'events must be a non-empty array' },
        { status: 400 }
      );
    }

    const analytics = await getUserBehaviorAnalytics();
    const result = await analytics.trackEvents({ userId, sessionId, events });

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    logger.error('Behavior POST error', { error });
    return NextResponse.json({ error: 'Failed to track behavior events' }, { status: 500 });
  }
}
