import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getIntelligentPricingEngine from '../../../../lib/intelligentPricingEngine';

const logger = getLogger();
const cache = getCache();

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const planId = searchParams.get('planId');

    const cacheKey = `pricing:${planId ?? 'all'}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }

    const engine = await getIntelligentPricingEngine();
    const data = planId
      ? await engine.getPlanOptimization(planId)
      : await engine.getPricingOverview();

    await cache.set(cacheKey, data, 120);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    logger.error('Pricing GET error', { error });
    return NextResponse.json({ error: 'Failed to retrieve pricing data' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { action, planId, targetRevenue, floorPrice, ceilingPrice, variant } = body;

    const VALID_ACTIONS = ['optimize', 'experiment', 'adjust'];
    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action is required and must be one of: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 }
      );
    }

    if (!planId) {
      return NextResponse.json({ error: 'planId is required' }, { status: 400 });
    }

    const engine = await getIntelligentPricingEngine();
    const result = await engine.applyPricingRule({
      action,
      planId,
      targetRevenue,
      floorPrice,
      ceilingPrice,
      variant,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error('Pricing POST error', { error });
    return NextResponse.json({ error: 'Failed to apply pricing rule' }, { status: 500 });
  }
}
