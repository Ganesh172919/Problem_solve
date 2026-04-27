import { NextRequest, NextResponse } from 'next/server';
import { getAutonomousRevenueOptimizer } from '../../../../lib/autonomousRevenueOptimizer';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') ?? 'default';
    const action = searchParams.get('action') ?? 'summary';
    const engine = getAutonomousRevenueOptimizer();

    if (action === 'summary') {
      return NextResponse.json({ success: true, data: engine.getSummary() });
    }
    if (action === 'elasticity') {
      const streamId = searchParams.get('streamId');
      if (!streamId) return NextResponse.json({ error: 'streamId is required' }, { status: 400 });
      return NextResponse.json({ success: true, data: engine.computeElasticity(streamId) });
    }
    if (action === 'expansion') {
      return NextResponse.json({ success: true, data: engine.detectExpansionOpportunities() });
    }
    if (action === 'contraction') {
      const riskLevel = searchParams.get('riskLevel') as Parameters<typeof engine.getContractionAlerts>[0];
      return NextResponse.json({ success: true, data: engine.getContractionAlerts(riskLevel ?? undefined) });
    }
    if (action === 'ltv') {
      return NextResponse.json({ success: true, data: engine.predictLTV(tenantId) });
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
    const engine = getAutonomousRevenueOptimizer();

    if (action === 'add_stream') {
      if (!body.stream) return NextResponse.json({ error: 'stream is required' }, { status: 400 });
      engine.addRevenueStream(body.stream);
      return NextResponse.json({ success: true });
    }
    if (action === 'record_event') {
      if (!body.event) return NextResponse.json({ error: 'event is required' }, { status: 400 });
      engine.recordRevenueEvent(body.event);
      return NextResponse.json({ success: true });
    }
    if (action === 'predict_ltv') {
      const tenantId = body.tenantId ?? body.userId ?? 'default';
      return NextResponse.json({ success: true, data: engine.predictLTV(tenantId) });
    }
    if (action === 'recommend_uplift') {
      const { modelId, name, controlRevenue, treatmentRevenue, sampleSize } = body;
      if (!modelId || !name || controlRevenue == null || treatmentRevenue == null || sampleSize == null) {
        return NextResponse.json({ error: 'modelId, name, controlRevenue, treatmentRevenue, and sampleSize are required' }, { status: 400 });
      }
      return NextResponse.json({ success: true, data: engine.generateUpliftRecommendations(modelId, name, controlRevenue, treatmentRevenue, sampleSize) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
