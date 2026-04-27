import { NextRequest, NextResponse } from 'next/server';
import { getAlertCorrelator } from '../../../../lib/aiPoweredAlertCorrelator';

const correlator = getAlertCorrelator();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const tenantId = searchParams.get('tenantId') ?? undefined;
  const alertId = searchParams.get('alertId') ?? undefined;
  const groupId = searchParams.get('groupId') ?? undefined;
  const status = searchParams.get('status') as Parameters<typeof correlator.listAlerts>[1];
  const severity = searchParams.get('severity') as Parameters<typeof correlator.listAlerts>[2];
  const openOnly = searchParams.get('openOnly') === 'true';
  const activeOnly = searchParams.get('activeOnly') === 'true';

  try {
    if (action === 'summary') return NextResponse.json(correlator.getSummary());
    if (action === 'alerts') return NextResponse.json(correlator.listAlerts(tenantId, status, severity));
    if (action === 'alert' && alertId) {
      const a = correlator.getAlert(alertId);
      if (!a) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
      return NextResponse.json(a);
    }
    if (action === 'groups') return NextResponse.json(correlator.listGroups(tenantId, openOnly));
    if (action === 'group' && groupId) {
      const g = correlator.getGroup(groupId);
      if (!g) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      return NextResponse.json(g);
    }
    if (action === 'rules') return NextResponse.json(correlator.listRules(tenantId));
    if (action === 'suppression_rules') return NextResponse.json(correlator.listSuppressionRules(tenantId));
    if (action === 'storms') return NextResponse.json(correlator.listStorms(activeOnly));
    if (action === 'insights') return NextResponse.json(correlator.listInsights(groupId));
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'create_rule') {
      return NextResponse.json(correlator.createRule(body as Parameters<typeof correlator.createRule>[0]), { status: 201 });
    }
    if (action === 'ingest') {
      return NextResponse.json(correlator.ingestAlert(body as Parameters<typeof correlator.ingestAlert>[0]), { status: 201 });
    }
    if (action === 'resolve') {
      const { alertId } = body as { alertId: string };
      return NextResponse.json(correlator.resolveAlert(alertId));
    }
    if (action === 'acknowledge') {
      const { alertId } = body as { alertId: string };
      return NextResponse.json(correlator.acknowledgeAlert(alertId));
    }
    if (action === 'escalate') {
      const { alertId } = body as { alertId: string };
      return NextResponse.json(correlator.escalateAlert(alertId));
    }
    if (action === 'create_suppression') {
      return NextResponse.json(correlator.createSuppressionRule(body as Parameters<typeof correlator.createSuppressionRule>[0]), { status: 201 });
    }
    if (action === 'create_escalation_policy') {
      return NextResponse.json(correlator.createEscalationPolicy(body as Parameters<typeof correlator.createEscalationPolicy>[0]), { status: 201 });
    }
    if (action === 'run_escalation_check') {
      return NextResponse.json({ escalated: correlator.runEscalationCheck() });
    }
    if (action === 'resolve_storm') {
      const { tenantId, serviceId } = body as { tenantId: string; serviceId: string };
      correlator.resolveStorm(tenantId, serviceId);
      return NextResponse.json({ resolved: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
