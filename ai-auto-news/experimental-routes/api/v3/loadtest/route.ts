import { NextRequest, NextResponse } from 'next/server';
import { getLoadTesting } from '../../../../lib/intelligentLoadTesting';

const engine = getLoadTesting();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const scenarioId = searchParams.get('scenarioId');
  const runId = searchParams.get('runId');
  const endpointId = searchParams.get('endpointId');

  try {
    if (action === 'summary') return NextResponse.json(engine.getDashboardSummary());
    if (action === 'scenarios') return NextResponse.json(engine.listScenarios());
    if (action === 'scenario' && scenarioId) {
      const s = engine.getScenario(scenarioId);
      if (!s) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
      return NextResponse.json(s);
    }
    if (action === 'runs') return NextResponse.json(engine.listRuns(scenarioId ?? undefined));
    if (action === 'run' && runId) {
      const r = engine.getRun(runId);
      if (!r) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
      return NextResponse.json(r);
    }
    if (action === 'calibration' && endpointId) {
      const c = engine.getCalibration(endpointId);
      if (!c) return NextResponse.json({ error: 'Calibration not found' }, { status: 404 });
      return NextResponse.json(c);
    }
    if (action === 'calibrations') return NextResponse.json(engine.listCalibrations());
    if (action === 'forecast' && scenarioId) return NextResponse.json(engine.forecastLoad(scenarioId));
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'create_scenario') {
      const scenario = engine.createScenario(body as Parameters<typeof engine.createScenario>[0]);
      return NextResponse.json(scenario, { status: 201 });
    }
    if (action === 'update_scenario') {
      const { scenarioId, updates } = body as { scenarioId: string; updates: Parameters<typeof engine.updateScenario>[1] };
      return NextResponse.json(engine.updateScenario(scenarioId, updates));
    }
    if (action === 'start_run') {
      const { scenarioId, distributedNodes } = body as { scenarioId: string; distributedNodes?: number };
      const run = engine.startRun(scenarioId, distributedNodes);
      return NextResponse.json(run, { status: 201 });
    }
    if (action === 'abort_run') {
      const { runId, reason } = body as { runId: string; reason: string };
      return NextResponse.json(engine.abortRun(runId, reason));
    }
    if (action === 'set_baseline') {
      const { endpointId, percentiles } = body as { endpointId: string; percentiles: Parameters<typeof engine.setBaseline>[1] };
      engine.setBaseline(endpointId, percentiles);
      return NextResponse.json({ ok: true });
    }
    if (action === 'capture_baseline') {
      const { runId } = body as { runId: string };
      engine.captureBaselineFromRun(runId);
      return NextResponse.json({ ok: true });
    }
    if (action === 'calibrate') {
      const { endpointId, samples } = body as { endpointId: string; samples: number[] };
      return NextResponse.json(engine.calibrateThresholds(endpointId, samples));
    }
    if (action === 'delete_scenario') {
      const { scenarioId } = body as { scenarioId: string };
      const deleted = engine.deleteScenario(scenarioId);
      return NextResponse.json({ ok: deleted });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
