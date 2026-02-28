import { NextRequest, NextResponse } from 'next/server';
import { getPredictiveChurnPreventor } from '../../../../lib/predictiveChurnPreventor';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') ?? 'default';
    const action = searchParams.get('action') ?? 'summary';
    const engine = getPredictiveChurnPreventor();

    if (action === 'summary') {
      return NextResponse.json({ success: true, data: engine.getSummary() });
    }
    if (action === 'risk_score') {
      const userId = searchParams.get('userId');
      if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
      return NextResponse.json({ success: true, data: engine.computeRiskScore(userId, tenantId) });
    }
    if (action === 'cohort') {
      const userId = searchParams.get('userId');
      if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
      const riskScore = engine.computeRiskScore(userId, tenantId);
      return NextResponse.json({ success: true, data: engine.classifyCohort(riskScore.score) });
    }
    if (action === 'history') {
      const monthYear = searchParams.get('monthYear') ?? new Date().toISOString().slice(0, 7);
      const totalUsers = parseInt(searchParams.get('totalUsers') ?? '100', 10);
      return NextResponse.json({ success: true, data: engine.analyzeChurnHistory(tenantId, monthYear, totalUsers) });
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
    const engine = getPredictiveChurnPreventor();

    if (action === 'ingest_signal') {
      if (!body.signal) return NextResponse.json({ error: 'signal is required' }, { status: 400 });
      engine.ingestBehaviorSignal(body.signal);
      return NextResponse.json({ success: true });
    }
    if (action === 'trigger_intervention') {
      const { userId, campaignId } = body;
      if (!userId || !campaignId) return NextResponse.json({ error: 'userId and campaignId are required' }, { status: 400 });
      return NextResponse.json({ success: true, data: engine.triggerIntervention(userId, campaignId) });
    }
    if (action === 'suggest_offer') {
      const { userId } = body;
      if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
      return NextResponse.json({ success: true, data: engine.suggestRetentionOffer(userId) });
    }
    if (action === 'register_campaign') {
      if (!body.campaign) return NextResponse.json({ error: 'campaign is required' }, { status: 400 });
      engine.registerCampaign(body.campaign);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
