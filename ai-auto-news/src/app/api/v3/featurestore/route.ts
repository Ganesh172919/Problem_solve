import { NextRequest, NextResponse } from 'next/server';
import { getFeatureStore } from '../../../../lib/realtimeFeatureStore';

const store = getFeatureStore();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const featureId = searchParams.get('featureId');
  const entityId = searchParams.get('entityId');
  const tenantId = searchParams.get('tenantId') ?? '';
  const groupId = searchParams.get('groupId');
  const asOf = searchParams.get('asOf');

  try {
    if (action === 'summary') return NextResponse.json(store.getDashboardSummary());
    if (action === 'definitions') return NextResponse.json(store.listDefinitions(tenantId || undefined));
    if (action === 'feature' && featureId) {
      const value = store.getFeature(featureId, entityId ?? '', tenantId);
      if (!value) return NextResponse.json({ error: 'Feature value not found' }, { status: 404 });
      return NextResponse.json(value);
    }
    if (action === 'vector' && entityId) {
      const featureIds = (searchParams.get('featureIds') ?? '').split(',').filter(Boolean);
      const asOfTs = asOf ? parseInt(asOf, 10) : undefined;
      return NextResponse.json(store.getFeatureVector(entityId, tenantId, featureIds, asOfTs));
    }
    if (action === 'history' && featureId && entityId) {
      const start = parseInt(searchParams.get('start') ?? '0', 10);
      const end = parseInt(searchParams.get('end') ?? String(Date.now()), 10);
      return NextResponse.json(store.getFeatureHistory(featureId, entityId, tenantId, start, end));
    }
    if (action === 'stats' && featureId) return NextResponse.json(store.computeStats(featureId, tenantId));
    if (action === 'drift' && featureId) {
      const report = store.detectDrift(featureId, tenantId);
      return NextResponse.json(report ?? { message: 'No significant drift detected' });
    }
    if (action === 'groups') return NextResponse.json(store.listGroups(tenantId || undefined));
    if (action === 'backfill_jobs') return NextResponse.json(store.listBackfillJobs(tenantId || undefined));
    if (action === 'drift_reports') return NextResponse.json(store.listDriftReports(featureId ?? undefined));
    if (action === 'datasets') return NextResponse.json(store.listDatasets(tenantId || undefined));
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'define_feature') {
      const def = store.defineFeature(body as Parameters<typeof store.defineFeature>[0]);
      return NextResponse.json(def, { status: 201 });
    }
    if (action === 'update_feature_def') {
      const { featureId, updates } = body as { featureId: string; updates: Parameters<typeof store.updateFeature>[1] };
      return NextResponse.json(store.updateFeature(featureId, updates));
    }
    if (action === 'deprecate') {
      const { featureId } = body as { featureId: string };
      return NextResponse.json(store.deprecateFeature(featureId));
    }
    if (action === 'create_group') {
      const group = store.createGroup(body as Parameters<typeof store.createGroup>[0]);
      return NextResponse.json(group, { status: 201 });
    }
    if (action === 'write') {
      const { featureId, entityId, tenantId, value, timestamp } = body as { featureId: string; entityId: string; tenantId: string; value: unknown; timestamp?: number };
      return NextResponse.json(store.writeFeature(featureId, entityId, tenantId, value, timestamp), { status: 201 });
    }
    if (action === 'write_batch') {
      const { writes } = body as { writes: Parameters<typeof store.writeBatch>[0] };
      return NextResponse.json(store.writeBatch(writes), { status: 201 });
    }
    if (action === 'set_baseline') {
      const { featureId, tenantId } = body as { featureId: string; tenantId: string };
      store.setBaseline(featureId, tenantId);
      return NextResponse.json({ ok: true });
    }
    if (action === 'schedule_backfill') {
      const { featureId, tenantId, startDate, endDate } = body as { featureId: string; tenantId: string; startDate: number; endDate: number };
      return NextResponse.json(store.scheduleBackfill(featureId, tenantId, startDate, endDate), { status: 201 });
    }
    if (action === 'generate_dataset') {
      const dataset = store.generateTrainingDataset(body as Parameters<typeof store.generateTrainingDataset>[0]);
      return NextResponse.json(dataset, { status: 201 });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
