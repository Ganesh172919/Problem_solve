import { NextRequest, NextResponse } from 'next/server';
import { getCohortAnalyzer } from '../../../../lib/predictiveCohortAnalyzer';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') ?? 'default';
    const action = searchParams.get('action') ?? 'summary';
    const analyzer = getCohortAnalyzer();

    if (action === 'summary') {
      return NextResponse.json({ success: true, data: analyzer.getSummary(tenantId) });
    }
    if (action === 'list') {
      return NextResponse.json({ success: true, data: analyzer.listCohorts(tenantId) });
    }
    if (action === 'churn_prediction') {
      const userId = searchParams.get('userId');
      const cohortId = searchParams.get('cohortId');
      if (!userId || !cohortId) return NextResponse.json({ error: 'userId and cohortId required' }, { status: 400 });
      return NextResponse.json({ success: true, data: analyzer.predictChurn(tenantId, userId, cohortId) });
    }
    if (action === 'resurrection') {
      const cohortId = searchParams.get('cohortId');
      if (!cohortId) return NextResponse.json({ error: 'cohortId required' }, { status: 400 });
      return NextResponse.json({ success: true, data: analyzer.identifyResurrectionOpportunities(cohortId) });
    }
    if (action === 'compare') {
      const cohortIdA = searchParams.get('cohortIdA');
      const cohortIdB = searchParams.get('cohortIdB');
      const metric = searchParams.get('metric') as Parameters<typeof analyzer.compareCohorts>[2];
      if (!cohortIdA || !cohortIdB || !metric) return NextResponse.json({ error: 'cohortIdA, cohortIdB, metric required' }, { status: 400 });
      return NextResponse.json({ success: true, data: analyzer.compareCohorts(cohortIdA, cohortIdB, metric) });
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
    const analyzer = getCohortAnalyzer();

    if (action === 'create_cohort') {
      const cohort = analyzer.createCohort(body.cohort);
      return NextResponse.json({ success: true, data: cohort });
    }
    if (action === 'record_activity') {
      analyzer.recordActivity(body.tenantId, body.userId, body.timestamp ?? Date.now(), body.revenueCents ?? 0);
      return NextResponse.json({ success: true });
    }
    if (action === 'refresh') {
      const updated = analyzer.refreshCohort(body.cohortId);
      return NextResponse.json({ success: true, data: updated });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
