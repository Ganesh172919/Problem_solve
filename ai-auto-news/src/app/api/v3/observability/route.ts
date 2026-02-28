import { NextRequest, NextResponse } from 'next/server';
import { getObservability } from '../../../../lib/aiPoweredObservability';
import type { AlertState } from '../../../../lib/aiPoweredObservability';

const obs = getObservability();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const tenantId = searchParams.get('tenantId') ?? undefined;
  const serviceId = searchParams.get('serviceId') ?? undefined;
  const state = (searchParams.get('state') ?? undefined) as AlertState | undefined;

  try {
    if (action === 'summary') return NextResponse.json(obs.getSummary());
    if (action === 'health' && serviceId) return NextResponse.json(obs.getServiceHealth(serviceId));
    if (action === 'report' && tenantId) return NextResponse.json(obs.generateReport(tenantId));
    if (action === 'alerts') return NextResponse.json(obs.listAlerts(tenantId, state));
    if (action === 'slos') return NextResponse.json(obs.listSlos(tenantId));
    if (action === 'logs') {
      const anomalousOnly = searchParams.get('anomalous') === 'true';
      return NextResponse.json(obs.listLogClusters(serviceId, anomalousOnly));
    }
    if (action === 'topology') return NextResponse.json(obs.getDependencyTopology());
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = (body.action as string) ?? '';

    if (action === 'ingest_signal') {
      obs.ingestSignal(body.signal as Parameters<typeof obs.ingestSignal>[0]);
      return NextResponse.json({ success: true });
    }
    if (action === 'ingest_trace') {
      obs.ingestTrace(body.trace as Parameters<typeof obs.ingestTrace>[0]);
      return NextResponse.json({ success: true });
    }
    if (action === 'ingest_log') {
      obs.ingestLog(body.serviceId as string, body.tenantId as string, body.message as string, body.severity as Parameters<typeof obs.ingestLog>[3]);
      return NextResponse.json({ success: true });
    }
    if (action === 'register_slo') {
      obs.registerSlo(body.slo as Parameters<typeof obs.registerSlo>[0]);
      return NextResponse.json({ success: true });
    }
    if (action === 'update_slo') {
      const ok = obs.updateSloValue(body.sloId as string, body.currentValue as number, body.burnRate as number);
      return NextResponse.json({ success: ok });
    }
    if (action === 'fire_alert') {
      obs.fireAlert(body.alert as Parameters<typeof obs.fireAlert>[0]);
      return NextResponse.json({ success: true });
    }
    if (action === 'resolve_alert') {
      const ok = obs.resolveAlert(body.dedupKey as string);
      return NextResponse.json({ success: ok });
    }
    if (action === 'silence_alert') {
      const ok = obs.silenceAlert(body.dedupKey as string, body.durationMs as number);
      return NextResponse.json({ success: ok });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
