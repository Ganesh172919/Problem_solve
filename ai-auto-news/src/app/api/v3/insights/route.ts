import { NextRequest, NextResponse } from 'next/server';
import { getInsightSurface } from '../../../../lib/aiDrivenInsightSurface';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') ?? 'default';
    const action = searchParams.get('action') ?? 'summary';
    const surface = getInsightSurface();

    if (action === 'summary') {
      return NextResponse.json({ success: true, data: surface.getSummary(tenantId) });
    }
    if (action === 'list') {
      const category = searchParams.get('category') as Parameters<typeof surface.listInsights>[1];
      const severity = searchParams.get('severity') as Parameters<typeof surface.listInsights>[2];
      const status = searchParams.get('status') as Parameters<typeof surface.listInsights>[3];
      return NextResponse.json({ success: true, data: surface.listInsights(tenantId, category, severity, status) });
    }
    if (action === 'top') {
      const limit = parseInt(searchParams.get('limit') ?? '10', 10);
      return NextResponse.json({ success: true, data: surface.getTopInsights(tenantId, limit) });
    }
    if (action === 'get') {
      const insightId = searchParams.get('insightId');
      if (!insightId) return NextResponse.json({ error: 'insightId required' }, { status: 400 });
      return NextResponse.json({ success: true, data: surface.getInsight(insightId) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const surface = getInsightSurface();

    if (action === 'register_rule') {
      surface.registerRule(body.rule);
      return NextResponse.json({ success: true });
    }
    if (action === 'ingest_metric') {
      const insights = surface.ingestMetric(body.snapshot);
      return NextResponse.json({ success: true, data: insights });
    }
    if (action === 'create_insight') {
      const insight = surface.createManualInsight(body.insight);
      return NextResponse.json({ success: true, data: insight });
    }
    if (action === 'acknowledge') {
      const ok = surface.acknowledgeInsight(body.insightId, body.userId);
      return NextResponse.json({ success: ok });
    }
    if (action === 'resolve') {
      const ok = surface.resolveInsight(body.insightId, body.userId);
      return NextResponse.json({ success: ok });
    }
    if (action === 'feedback') {
      surface.submitFeedback(body.feedback);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
