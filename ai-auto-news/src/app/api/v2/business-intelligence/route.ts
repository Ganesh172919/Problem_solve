import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../../lib/logger';
import { getCache } from '../../../../lib/cache';
import getBusinessIntelligenceEngine from '../../../../lib/businessIntelligenceEngine';

const logger = getLogger();
const cache = getCache();

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const report = searchParams.get('report');
    const period = searchParams.get('period');

    const VALID_REPORTS = ['executive', 'board', 'growth'];
    const VALID_PERIODS = ['MoM', 'QoQ', 'YoY'];

    if (report && !VALID_REPORTS.includes(report)) {
      return NextResponse.json(
        { error: `Invalid report type. Must be one of: ${VALID_REPORTS.join(', ')}` },
        { status: 400 }
      );
    }

    if (period && !VALID_PERIODS.includes(period)) {
      return NextResponse.json(
        { error: `Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}` },
        { status: 400 }
      );
    }

    const cacheKey = `bi:${report ?? 'dashboard'}:${period ?? 'default'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }

    const engine = getBusinessIntelligenceEngine();
    let data;
    if (report === 'board') {
      const now = new Date();
      const quarter = (Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
      data = await engine.getBoardMetrics(now.getFullYear(), quarter);
    } else {
      const periodDays = period === 'YoY' ? 365 : period === 'QoQ' ? 90 : 30;
      data = await engine.getExecutiveDashboard(periodDays);
    }

    cache.set(cacheKey, data, 600);
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    logger.error('Business Intelligence GET error', { error });
    return NextResponse.json({ error: 'Failed to retrieve business intelligence data' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { reportName, metrics, filters, groupBy, compareWith } = body;

    if (!reportName || !metrics || !Array.isArray(metrics) || metrics.length === 0) {
      return NextResponse.json(
        { error: 'reportName and a non-empty metrics array are required' },
        { status: 400 }
      );
    }

    const engine = getBusinessIntelligenceEngine();
    const now = new Date();
    const definition = {
      id: `custom-${Date.now()}`,
      name: reportName,
      metrics,
      filters: filters ?? [],
      groupBy: groupBy ? [groupBy] : [],
      dateRange: { start: new Date(now.getTime() - 30 * 86400000), end: now },
      createdBy: 'api',
      createdAt: now,
    };
    const result = await engine.buildReport(definition);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error('Business Intelligence POST error', { error });
    return NextResponse.json({ error: 'Failed to build custom report' }, { status: 500 });
  }
}
