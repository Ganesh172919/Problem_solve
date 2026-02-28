import { NextRequest, NextResponse } from 'next/server';
import { getSLAManager } from '../../../../lib/intelligentSLAManager';

const slaManager = getSLAManager();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const tenantId = searchParams.get('tenantId');
  const slaId = searchParams.get('slaId');

  try {
    if (action === 'summary' && !slaId) {
      return NextResponse.json(slaManager.generatePortfolioReport(Date.now() - 86_400_000, Date.now()));
    }
    if (action === 'state' && slaId) {
      const state = slaManager.getState(slaId);
      if (!state) return NextResponse.json({ error: 'SLA not found' }, { status: 404 });
      return NextResponse.json(state);
    }
    if (action === 'breaches') {
      return NextResponse.json(slaManager.getBreaches(slaId ?? undefined, false));
    }
    if (action === 'list') {
      return NextResponse.json(slaManager.listSLAs(tenantId ?? undefined));
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'define') {
      const sla = slaManager.defineSLA(body as Parameters<typeof slaManager.defineSLA>[0]);
      return NextResponse.json(sla, { status: 201 });
    }
    if (action === 'observe') {
      const { slaId, serviceId, metricType, value } = body as { slaId: string; serviceId: string; metricType: Parameters<typeof slaManager.recordObservation>[2]; value: number };
      const obs = slaManager.recordObservation(slaId, serviceId, metricType, value);
      return NextResponse.json(obs);
    }
    if (action === 'predict') {
      const { slaId, metricType } = body as { slaId: string; metricType: Parameters<typeof slaManager.predictBreach>[1] };
      const result = slaManager.predictBreach(slaId, metricType);
      return NextResponse.json(result);
    }
    if (action === 'resolve_breach') {
      const { breachId, rootCause } = body as { breachId: string; rootCause: string };
      slaManager.resolveBreachById(breachId, rootCause);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
