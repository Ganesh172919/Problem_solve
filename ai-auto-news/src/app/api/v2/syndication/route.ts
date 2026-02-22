import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getContentSyndicationEngine, { type SyndicationPartner } from '../../../../lib/contentSyndicationEngine';

const logger = getLogger();
const cache = getCache();

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const partnerId = searchParams.get('partnerId');

    const cacheKey = `syndication:partners:${partnerId ?? 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }

    const engine = getContentSyndicationEngine();
    let data;
    if (partnerId) {
      const status = engine.getPartnerStatus(partnerId);
      data = status ?? { error: 'Partner not found' };
    } else {
      data = engine.getPartners();
    }

    cache.set(cacheKey, data, 60);
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

    const engine = getContentSyndicationEngine();
    const ids = partnerIds ?? engine.getPartners().map((p: SyndicationPartner) => p.id);
    const result = await engine.syndicateContent(contentId, ids, 'json');

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    logger.error('Syndication POST error', { error });
    return NextResponse.json({ error: 'Failed to syndicate content' }, { status: 500 });
  }
}
