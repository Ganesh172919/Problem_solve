import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getContentSyndicationEngine from '../../../../lib/contentSyndicationEngine';

const logger = getLogger();
const cache = getCache();

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const partnerId = searchParams.get('partnerId');

    const cacheKey = `syndication:partners:${partnerId ?? 'all'}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }

    const engine = await getContentSyndicationEngine();
    const data = partnerId
      ? await engine.getPartner(partnerId)
      : await engine.listPartners();

    await cache.set(cacheKey, data, 60);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    logger.error('Syndication GET error', { error });
    return NextResponse.json({ error: 'Failed to retrieve syndication partners' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { contentId, title, content, partnerIds, scheduleAt } = body;

    if (!contentId || !title || !content) {
      return NextResponse.json(
        { error: 'contentId, title, and content are required' },
        { status: 400 }
      );
    }

    const engine = await getContentSyndicationEngine();
    const result = await engine.syndicate({
      contentId,
      title,
      content,
      partnerIds,
      scheduleAt,
    });

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    logger.error('Syndication POST error', { error });
    return NextResponse.json({ error: 'Failed to syndicate content' }, { status: 500 });
  }
}
