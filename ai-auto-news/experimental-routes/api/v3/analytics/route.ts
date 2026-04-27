import { NextRequest, NextResponse } from 'next/server';
import { getMultiTenantAnalytics } from '@/lib/multiTenantAnalytics';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  const period = (searchParams.get('period') ?? 'day') as 'minute' | 'hour' | 'day' | 'week' | 'month';
  const action = searchParams.get('action') ?? 'dashboard';

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  const analytics = getMultiTenantAnalytics();

  try {
    switch (action) {
      case 'dashboard': {
        const summary = analytics.getDashboardSummary(tenantId, period);
        return NextResponse.json({ success: true, data: summary });
      }
      case 'cohorts': {
        const cohorts = analytics.getCohortAnalysis(tenantId, period);
        return NextResponse.json({ success: true, data: cohorts });
      }
      case 'churn': {
        const predictions = analytics.predictChurn(tenantId);
        return NextResponse.json({ success: true, data: predictions });
      }
      case 'benchmark': {
        const industry = searchParams.get('industry') ?? 'saas';
        const report = analytics.getBenchmark(tenantId, industry);
        return NextResponse.json({ success: true, data: report });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const analytics = getMultiTenantAnalytics();

  const { action } = body;

  try {
    switch (action) {
      case 'track': {
        const event = analytics.track(body.event);
        return NextResponse.json({ success: true, data: event });
      }
      case 'register_tenant': {
        analytics.registerTenant(body.config);
        return NextResponse.json({ success: true });
      }
      case 'define_funnel': {
        const funnel = analytics.defineFunnel(body.funnel);
        return NextResponse.json({ success: true, data: funnel });
      }
      case 'analyze_funnel': {
        const result = analytics.analyzeFunnel(body.tenantId, body.funnelId, body.windowMs);
        return NextResponse.json({ success: true, data: result });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
