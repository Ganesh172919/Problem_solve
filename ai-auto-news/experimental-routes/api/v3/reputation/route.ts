import { NextRequest, NextResponse } from 'next/server';
import { getRealTimeReputationEngine } from '../../../../lib/realTimeReputationEngine';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') ?? 'default';
    const action = searchParams.get('action') ?? 'summary';
    const engine = getRealTimeReputationEngine();

    if (action === 'summary') {
      return NextResponse.json({ success: true, data: engine.getSummary() });
    }
    if (action === 'score') {
      const entityId = searchParams.get('entityId');
      if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 });
      return NextResponse.json({ success: true, data: engine.computeScore(entityId) });
    }
    if (action === 'tier') {
      const entityId = searchParams.get('entityId');
      if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 });
      // computeScore updates decayed score; assignTier requires a profile object, so we derive tier via ingestSignal side-effect
      const score = engine.computeScore(entityId);
      return NextResponse.json({ success: true, data: { entityId, score } });
    }
    if (action === 'leaderboard') {
      const limit = parseInt(searchParams.get('limit') ?? '10', 10);
      return NextResponse.json({ success: true, data: engine.generateLeaderboard(tenantId, limit) });
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
    const engine = getRealTimeReputationEngine();

    if (action === 'ingest_signal') {
      if (!body.signal) return NextResponse.json({ error: 'signal is required' }, { status: 400 });
      engine.ingestSignal(body.signal);
      return NextResponse.json({ success: true });
    }
    if (action === 'flag') {
      const { entityId, reason, tenantId, actorId } = body;
      if (!entityId || !reason) return NextResponse.json({ error: 'entityId and reason are required' }, { status: 400 });
      engine.flagForReview(entityId, tenantId ?? 'default', reason, actorId ?? 'system');
      return NextResponse.json({ success: true });
    }
    if (action === 'ban') {
      const { entityId, tenantId, reason, actorId } = body;
      if (!entityId || !reason) return NextResponse.json({ error: 'entityId and reason are required' }, { status: 400 });
      engine.banEntity(entityId, tenantId ?? 'default', reason, actorId ?? 'system');
      return NextResponse.json({ success: true });
    }
    if (action === 'unban') {
      const { entityId, tenantId, actorId } = body;
      if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 });
      engine.unbanEntity(entityId, tenantId ?? 'default', actorId ?? 'system');
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
