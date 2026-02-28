import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getFeatureFlagEngine } from '@/lib/featureFlagEngine';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    const engine = getFeatureFlagEngine();

    if (action === 'stats') {
      const stats = engine.getStats();
      return NextResponse.json({ success: true, data: { stats } });
    }

    if (action === 'audit') {
      const flagKey = searchParams.get('flagKey') as string;
      const audit = engine.getAuditLog(flagKey);
      return NextResponse.json({ success: true, data: { flagKey, audit } });
    }

    if (action === 'evaluate') {
      const flagKey = searchParams.get('flagKey') as string;
      const context = JSON.parse(searchParams.get('context') ?? '{}');
      const result = engine.evaluate(flagKey, context);
      return NextResponse.json({ success: true, data: { flagKey, result } });
    }

    const flags = engine.getAllFlags();
    return NextResponse.json({ success: true, data: { flags } });
  } catch (err) {
    logger.error('FeatureFlags GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;

    const engine = getFeatureFlagEngine();

    if (action === 'create') {
      const flag = engine.createFlag(body.flag as Parameters<typeof engine.createFlag>[0]);
      return NextResponse.json({ success: true, data: { flag } });
    }

    if (action === 'update') {
      const flag = engine.updateFlag(body.flagKey as string, body.updates as Record<string, unknown>);
      return NextResponse.json({ success: true, data: { flag } });
    }

    if (action === 'delete') {
      engine.deleteFlag(body.flagKey as string);
      return NextResponse.json({ success: true, data: { message: 'Flag deleted' } });
    }

    if (action === 'override') {
      engine.setOverride(body.flagKey as string, body.context as Record<string, unknown>, body.value as unknown);
      return NextResponse.json({ success: true, data: { message: 'Override applied' } });
    }

    if (action === 'evaluate_all') {
      const context = body.context as Record<string, unknown>;
      const results = engine.evaluateAll(context);
      return NextResponse.json({ success: true, data: { results } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('FeatureFlags POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
