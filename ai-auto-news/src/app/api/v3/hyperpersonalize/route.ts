import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getHyperPersonalization } from '@/lib/hyperPersonalizationEngine';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const tenantId = searchParams.get('tenantId');
  const experimentId = searchParams.get('experimentId');

  try {
    const engine = getHyperPersonalization();

    if (userId) {
      const profile = engine.getProfile(userId);
      if (!profile) return NextResponse.json({ success: false, error: 'Profile not found' }, { status: 404 });
      return NextResponse.json({ success: true, data: { profile } });
    }

    if (experimentId) {
      const analysis = engine.analyzeExperiment(experimentId);
      return NextResponse.json({ success: true, data: { analysis } });
    }

    const distribution = engine.getSegmentDistribution(tenantId ?? undefined);
    return NextResponse.json({ success: true, data: { segmentDistribution: distribution } });
  } catch (err) {
    logger.error('HyperPersonalize GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;
    const engine = getHyperPersonalization();

    if (action === 'upsert_profile') {
      const profile = engine.upsertProfile(body.params as Parameters<typeof engine.upsertProfile>[0]);
      return NextResponse.json({ success: true, data: { profile } });
    }

    if (action === 'ingest_signal') {
      const signal = body.signal as Parameters<typeof engine.ingestSignal>[0];
      engine.ingestSignal(signal);
      return NextResponse.json({ success: true, data: { message: 'Signal ingested' } });
    }

    if (action === 'bulk_signals') {
      const signals = body.signals as Parameters<typeof engine.bulkIngestSignals>[0];
      engine.bulkIngestSignals(signals);
      return NextResponse.json({ success: true, data: { message: `${signals.length} signals ingested` } });
    }

    if (action === 'decide') {
      const { userId, dimension, candidates } = body as { userId: string; dimension: Parameters<typeof engine.decide>[1]; candidates: string[] };
      const decision = engine.decide(userId, dimension, candidates);
      return NextResponse.json({ success: true, data: { decision } });
    }

    if (action === 'recommendations') {
      const { userId, catalog, limit } = body as { userId: string; catalog: Parameters<typeof engine.getRecommendations>[1]; limit?: number };
      const recommendations = engine.getRecommendations(userId, catalog, limit);
      return NextResponse.json({ success: true, data: { recommendations } });
    }

    if (action === 'next_best_actions') {
      const { userId, availableActions } = body as { userId: string; availableActions: Parameters<typeof engine.getNextBestActions>[1] };
      const actions = engine.getNextBestActions(userId, availableActions);
      return NextResponse.json({ success: true, data: { actions } });
    }

    if (action === 'personalized_ui') {
      const { userId, availableWidgets } = body as { userId: string; availableWidgets: string[] };
      const uiConfig = engine.getPersonalizedUI(userId, availableWidgets);
      return NextResponse.json({ success: true, data: { uiConfig } });
    }

    if (action === 'create_experiment') {
      const experiment = engine.createExperiment(body.experiment as Parameters<typeof engine.createExperiment>[0]);
      return NextResponse.json({ success: true, data: { experiment } });
    }

    if (action === 'assign_variant') {
      const { experimentId, userId } = body as { experimentId: string; userId: string };
      const variant = engine.assignToVariant(experimentId, userId);
      return NextResponse.json({ success: true, data: { variant } });
    }

    if (action === 'record_variant_result') {
      const { experimentId, variantId, converted, revenue } = body as { experimentId: string; variantId: string; converted: boolean; revenue?: number };
      engine.recordVariantResult(experimentId, variantId, converted, revenue);
      return NextResponse.json({ success: true, data: { message: 'Result recorded' } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('HyperPersonalize POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
