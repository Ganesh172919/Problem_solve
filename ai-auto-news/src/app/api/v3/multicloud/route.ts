import { NextRequest, NextResponse } from 'next/server';
import { getMultiCloudOrchestrator } from '../../../../lib/multiCloudOrchestrator';
import type { CloudProvider } from '../../../../lib/multiCloudOrchestrator';

const orchestrator = getMultiCloudOrchestrator();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const tenantId = searchParams.get('tenantId') ?? undefined;
  const provider = (searchParams.get('provider') ?? undefined) as CloudProvider | undefined;
  const regionId = searchParams.get('regionId') ?? undefined;

  try {
    if (action === 'summary') return NextResponse.json(orchestrator.getSummary());
    if (action === 'regions') return NextResponse.json(orchestrator.listRegions(provider));
    if (action === 'region' && regionId) {
      const r = orchestrator.getRegion(regionId);
      if (!r) return NextResponse.json({ error: 'Region not found' }, { status: 404 });
      return NextResponse.json(r);
    }
    if (action === 'resources') return NextResponse.json(orchestrator.listResources(tenantId, provider));
    if (action === 'placements') return NextResponse.json(orchestrator.listPlacements());
    if (action === 'recommendations') {
      const applied = searchParams.get('applied');
      return NextResponse.json(orchestrator.listRecommendations(applied === null ? undefined : applied === 'true'));
    }
    if (action === 'analyze') return NextResponse.json(orchestrator.analyzeAndRecommend(tenantId));
    if (action === 'budgets') return NextResponse.json(orchestrator.checkBudgets());
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = (body.action as string) ?? '';

    if (action === 'register_region') {
      orchestrator.registerRegion(body.region as Parameters<typeof orchestrator.registerRegion>[0]);
      return NextResponse.json({ success: true });
    }
    if (action === 'provision') {
      const resource = orchestrator.provisionResource(body.resource as Parameters<typeof orchestrator.provisionResource>[0]);
      return NextResponse.json(resource);
    }
    if (action === 'terminate') {
      const ok = orchestrator.terminateResource(body.resourceId as string);
      return NextResponse.json({ success: ok });
    }
    if (action === 'place_workload') {
      const placement = orchestrator.placeWorkload(body.placement as Parameters<typeof orchestrator.placeWorkload>[0]);
      return NextResponse.json(placement);
    }
    if (action === 'failover') {
      const event = orchestrator.triggerFailover(body.tenantId as string, body.failedRegionId as string, body.reason as string);
      return NextResponse.json(event);
    }
    if (action === 'apply_recommendation') {
      const ok = orchestrator.applyRecommendation(body.recommendationId as string);
      return NextResponse.json({ success: ok });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
