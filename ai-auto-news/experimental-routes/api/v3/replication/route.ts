import { NextRequest, NextResponse } from 'next/server';
import { getReplicationEngine } from '../../../../lib/crossRegionReplicationEngine';

const engine = getReplicationEngine();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const groupId = searchParams.get('groupId');
  const regionId = searchParams.get('regionId');
  const tenantId = searchParams.get('tenantId');

  try {
    if (action === 'summary') return NextResponse.json(engine.getDashboardSummary());
    if (action === 'groups') return NextResponse.json(engine.listGroups(tenantId ?? undefined));
    if (action === 'regions') return NextResponse.json(engine.listRegions());
    if (action === 'health' && groupId) {
      const h = engine.getHealth(groupId);
      if (!h) return NextResponse.json({ error: 'Health status not available' }, { status: 404 });
      return NextResponse.json(h);
    }
    if (action === 'metrics' && groupId) return NextResponse.json(engine.getMetrics(groupId, regionId ?? undefined));
    if (action === 'conflicts' && groupId) return NextResponse.json(engine.listConflicts(groupId));
    if (action === 'failovers' && groupId) return NextResponse.json(engine.listFailoverEvents(groupId));
    if (action === 'snapshots') return NextResponse.json(engine.listSnapshots(groupId ?? undefined));
    if (action === 'schema_changes' && groupId) return NextResponse.json(engine.listSchemaChanges(groupId));
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'register_region') {
      const region = engine.registerRegion(body as Parameters<typeof engine.registerRegion>[0]);
      return NextResponse.json(region, { status: 201 });
    }
    if (action === 'create_group') {
      const group = engine.createReplicationGroup(body as Parameters<typeof engine.createReplicationGroup>[0]);
      return NextResponse.json(group, { status: 201 });
    }
    if (action === 'update_group') {
      const { groupId, updates } = body as { groupId: string; updates: Parameters<typeof engine.updateGroup>[1] };
      return NextResponse.json(engine.updateGroup(groupId, updates));
    }
    if (action === 'trigger_failover') {
      const { groupId, trigger, notes } = body as { groupId: string; trigger: Parameters<typeof engine.triggerFailover>[1]; notes?: string };
      return NextResponse.json(engine.triggerFailover(groupId, trigger, notes));
    }
    if (action === 'record_conflict') {
      const conflict = engine.recordConflict(body as Parameters<typeof engine.recordConflict>[0]);
      return NextResponse.json(conflict, { status: 201 });
    }
    if (action === 'propagate_schema_change') {
      const change = engine.propagateSchemaChange(body as Parameters<typeof engine.propagateSchemaChange>[0]);
      return NextResponse.json(change, { status: 201 });
    }
    if (action === 'create_snapshot') {
      const { groupId, tables } = body as { groupId: string; tables: string[] };
      return NextResponse.json(engine.createSnapshot(groupId, tables), { status: 201 });
    }
    if (action === 'stop_monitoring') {
      const { groupId } = body as { groupId: string };
      engine.stopMonitoring(groupId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
