import { NextRequest, NextResponse } from 'next/server';
import { getABTestingEngine } from '../../../../lib/aiDrivenABTestingEngine';
import type { Experiment, MetricObservation } from '../../../../lib/aiDrivenABTestingEngine';

const engine = getABTestingEngine();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const experimentId = searchParams.get('experimentId') ?? undefined;
  const tenantId = searchParams.get('tenantId') ?? undefined;

  try {
    if (action === 'summary') return NextResponse.json(engine.getSummary());
    if (action === 'experiments') {
      const status = searchParams.get('status') as Experiment['status'] | null;
      return NextResponse.json(engine.listExperiments(tenantId, status ?? undefined));
    }
    if (action === 'experiment' && experimentId) {
      const exp = engine.getExperiment(experimentId);
      if (!exp) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
      return NextResponse.json(exp);
    }
    if (action === 'statistics' && experimentId) {
      return NextResponse.json(engine.computeStatistics(experimentId));
    }
    if (action === 'assignment' && experimentId) {
      const userId = searchParams.get('userId');
      if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
      const assignment = engine.getAssignment(experimentId, userId);
      return NextResponse.json({ assignment: assignment ?? null });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = (body.action as string) ?? '';

    if (action === 'create') {
      engine.createExperiment(body.experiment as Experiment);
      return NextResponse.json({ success: true });
    }
    if (action === 'start') {
      const ok = engine.startExperiment(body.experimentId as string);
      return NextResponse.json({ success: ok });
    }
    if (action === 'assign') {
      const assignment = engine.assignUser(
        body.experimentId as string, body.userId as string,
        (body.userAttributes as Record<string, unknown>) ?? {}
      );
      return NextResponse.json({ assignment: assignment ?? null, assigned: assignment !== null });
    }
    if (action === 'observe') {
      engine.recordObservation(body.observation as MetricObservation);
      return NextResponse.json({ success: true });
    }
    if (action === 'statistics') {
      const stats = engine.computeStatistics(body.experimentId as string);
      return NextResponse.json({ statistics: stats });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
