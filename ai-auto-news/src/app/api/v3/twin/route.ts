import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getDigitalTwinEngine } from '@/lib/digitalTwinEngine';
import { getDigitalTwinAgent } from '@/agents/digitalTwinAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const twinId = searchParams.get('twinId');
  const entityId = searchParams.get('entityId');
  const action = searchParams.get('action');

  try {
    const engine = getDigitalTwinEngine();
    const agent = getDigitalTwinAgent();

    if (twinId && action === 'snapshots') {
      const snapshots = engine.getSnapshots(twinId);
      return NextResponse.json({ success: true, data: { snapshots } });
    }

    if (twinId) {
      const twin = engine.getTwin(twinId);
      if (!twin) return NextResponse.json({ success: false, error: 'Twin not found' }, { status: 404 });
      return NextResponse.json({ success: true, data: { twin } });
    }

    if (entityId) {
      const twin = engine.getTwinByEntityId(entityId);
      if (!twin) return NextResponse.json({ success: false, error: 'Twin not found for entity' }, { status: 404 });
      return NextResponse.json({ success: true, data: { twin } });
    }

    const twins = engine.listTwins();
    const driftSummary = engine.getGlobalDriftSummary();
    const agentStats = agent.getStats();
    const latestReport = agent.getLatestReport();

    return NextResponse.json({ success: true, data: { twins, driftSummary, agentStats, latestReport } });
  } catch (err) {
    logger.error('Twin GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;
    const engine = getDigitalTwinEngine();
    const agent = getDigitalTwinAgent();

    if (action === 'register') {
      const twin = engine.registerTwin(body.params as Parameters<typeof engine.registerTwin>[0]);
      return NextResponse.json({ success: true, data: { twin } });
    }

    if (action === 'sync') {
      const event = body.event as Parameters<typeof engine.syncState>[0];
      const twin = engine.syncState(event);
      return NextResponse.json({ success: true, data: { twin } });
    }

    if (action === 'bulk_sync') {
      const events = body.events as Parameters<typeof engine.bulkSync>[0];
      const twins = engine.bulkSync(events);
      return NextResponse.json({ success: true, data: { twins, count: twins.length } });
    }

    if (action === 'ingest_telemetry') {
      const { twinId, telemetry } = body as { twinId: string; telemetry: Record<string, unknown> };
      agent.ingestTelemetry(twinId, telemetry);
      return NextResponse.json({ success: true, data: { message: 'Telemetry ingested' } });
    }

    if (action === 'snapshot') {
      const { twinId, label } = body as { twinId: string; label?: string };
      const snapshot = engine.takeSnapshot(twinId, label);
      return NextResponse.json({ success: true, data: { snapshot } });
    }

    if (action === 'restore') {
      const { twinId, snapshotId } = body as { twinId: string; snapshotId: string };
      const twin = engine.restoreSnapshot(twinId, snapshotId);
      return NextResponse.json({ success: true, data: { twin } });
    }

    if (action === 'simulate') {
      const scenario = engine.createScenario(body.scenario as Parameters<typeof engine.createScenario>[0]);
      const result = await engine.runSimulation(scenario.scenarioId);
      return NextResponse.json({ success: true, data: { scenario, result } });
    }

    if (action === 'analyze_drift') {
      const { twinId, realWorldState, realWorldMetrics } = body as { twinId: string; realWorldState: Record<string, unknown>; realWorldMetrics: Record<string, number> };
      const report = engine.analyzeDrift(twinId, realWorldState, realWorldMetrics);
      return NextResponse.json({ success: true, data: { report } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Twin POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
