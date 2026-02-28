import { NextRequest, NextResponse } from 'next/server';
import { getTrafficShaper } from '../../../../lib/distributedTrafficShaper';

const shaper = getTrafficShaper();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const tenantId = searchParams.get('tenantId') ?? undefined;
  const policyId = searchParams.get('policyId') ?? undefined;
  const serviceId = searchParams.get('serviceId') ?? undefined;
  const activeOnly = searchParams.get('activeOnly') === 'true';

  try {
    if (action === 'summary') return NextResponse.json(shaper.getSummary());
    if (action === 'policies') return NextResponse.json(shaper.listPolicies(tenantId));
    if (action === 'policy' && policyId) {
      const p = shaper.getPolicy(policyId);
      if (!p) return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
      return NextResponse.json(p);
    }
    if (action === 'metrics') return NextResponse.json(shaper.listMetrics(tenantId));
    if (action === 'metric' && policyId) {
      const m = shaper.getMetrics(policyId);
      if (!m) return NextResponse.json({ error: 'Metrics not found' }, { status: 404 });
      return NextResponse.json(m);
    }
    if (action === 'buckets') return NextResponse.json(shaper.listBuckets());
    if (action === 'bucket' && policyId) {
      const b = shaper.getBucket(policyId);
      if (!b) return NextResponse.json({ error: 'Bucket not found' }, { status: 404 });
      return NextResponse.json(b);
    }
    if (action === 'decisions') return NextResponse.json(shaper.listDecisions(policyId));
    if (action === 'congestions') return NextResponse.json(shaper.listCongestions(activeOnly));
    if (action === 'queue_depth') return NextResponse.json({ depth: shaper.getQueueDepth(policyId) });
    if (action === 'bandwidth') return NextResponse.json(shaper.computeBandwidthAllocations());
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'create_policy') {
      const policy = shaper.createPolicy(body as Parameters<typeof shaper.createPolicy>[0]);
      return NextResponse.json(policy, { status: 201 });
    }
    if (action === 'update_policy') {
      const { id, ...updates } = body as { id: string } & Record<string, unknown>;
      return NextResponse.json(shaper.updatePolicy(id, updates));
    }
    if (action === 'delete_policy') {
      const { id } = body as { id: string };
      shaper.deletePolicy(id);
      return NextResponse.json({ deleted: true });
    }
    if (action === 'evaluate') {
      const decision = shaper.evaluateRequest(body as Parameters<typeof shaper.evaluateRequest>[0]);
      return NextResponse.json(decision);
    }
    if (action === 'record_congestion') {
      const { serviceId, tenantId, rps } = body as { serviceId: string; tenantId: string; rps: number };
      return NextResponse.json(shaper.recordCongestion(serviceId, tenantId, rps), { status: 201 });
    }
    if (action === 'resolve_congestion') {
      const { serviceId, tenantId } = body as { serviceId: string; tenantId: string };
      shaper.resolveCongestion(serviceId, tenantId);
      return NextResponse.json({ resolved: true });
    }
    if (action === 'dequeue') {
      const { policyId } = body as { policyId?: string };
      return NextResponse.json(shaper.dequeueNext(policyId) ?? null);
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
