import { NextRequest, NextResponse } from 'next/server';
import { getGoalTracker } from '../../../../lib/autonomousGoalTracker';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') ?? 'default';
    const action = searchParams.get('action') ?? 'summary';
    const tracker = getGoalTracker();

    if (action === 'summary') {
      return NextResponse.json({ success: true, data: tracker.getSummary(tenantId) });
    }
    if (action === 'list') {
      const level = searchParams.get('level') as Parameters<typeof tracker.listObjectives>[1];
      const status = searchParams.get('status') as Parameters<typeof tracker.listObjectives>[2];
      return NextResponse.json({ success: true, data: tracker.listObjectives(tenantId, level, status) });
    }
    if (action === 'at_risk') {
      return NextResponse.json({ success: true, data: tracker.listAtRiskObjectives(tenantId) });
    }
    if (action === 'forecast') {
      const objectiveId = searchParams.get('objectiveId');
      if (!objectiveId) return NextResponse.json({ error: 'objectiveId required' }, { status: 400 });
      return NextResponse.json({ success: true, data: tracker.forecastObjective(objectiveId) });
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
    const tracker = getGoalTracker();

    if (action === 'create_objective') {
      tracker.createObjective(body.objective);
      return NextResponse.json({ success: true, data: tracker.getObjective(body.objective.id) });
    }
    if (action === 'add_key_result') {
      tracker.addKeyResult(body.keyResult);
      return NextResponse.json({ success: true, data: tracker.getKeyResult(body.keyResult.id) });
    }
    if (action === 'record_check_in') {
      const result = tracker.recordCheckIn(body.checkIn);
      return NextResponse.json({ success: true, data: result });
    }
    if (action === 'update_status') {
      const ok = tracker.updateObjectiveStatus(body.objectiveId, body.status);
      return NextResponse.json({ success: ok });
    }
    if (action === 'detect_alignments') {
      const alignments = tracker.detectAlignments(body.objectiveId);
      return NextResponse.json({ success: true, data: alignments });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
