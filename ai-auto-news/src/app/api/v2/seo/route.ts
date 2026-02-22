import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getAIPoweredSEO from '../../../../lib/aiPoweredSEO';

const logger = getLogger();
const cache = getCache();

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const contentId = searchParams.get('contentId');
    const url = searchParams.get('url');

    const cacheKey = `seo:${contentId ?? ''}:${url ?? ''}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }

    const seo = getAIPoweredSEO();
    const doc = {
      id: contentId ?? url ?? '',
      url: url ?? '',
      title: '',
      description: '',
      body: '',
      headings: [],
      tags: [],
      publishedAt: new Date(),
    };
    const analysis = seo.analyzeContent(doc);

    cache.set(cacheKey, analysis, 300);
    return NextResponse.json(analysis, { status: 200 });
  } catch (error) {
    logger.error('SEO GET error', { error });
    return NextResponse.json({ error: 'Failed to retrieve SEO analysis' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { contentId, title, description, body: content, url, competitors } = body;

    if (!contentId || !title || !description || !content || !url) {
      return NextResponse.json(
        { error: 'contentId, title, description, body, and url are required' },
        { status: 400 }
      );
    }

    const seo = getAIPoweredSEO();
    const doc = {
      id: contentId,
      url,
      title,
      description,
      body: content,
      headings: [],
      tags: competitors ?? [],
      publishedAt: new Date(),
    };
    const result = seo.analyzeContent(doc);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error('SEO POST error', { error });
    return NextResponse.json({ error: 'Failed to run SEO analysis and optimization' }, { status: 500 });
  }
}
