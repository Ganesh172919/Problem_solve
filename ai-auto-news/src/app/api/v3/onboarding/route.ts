import { NextRequest, NextResponse } from 'next/server';
import { getOnboardingEngine } from '../../../../lib/enterpriseOnboardingEngine';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') ?? 'default';
    const action = searchParams.get('action') ?? 'summary';
    const engine = getOnboardingEngine();

    if (action === 'summary') {
      return NextResponse.json({ success: true, data: engine.getSummary() });
    }
    if (action === 'sessions') {
      const status = searchParams.get('status') as Parameters<typeof engine.listSessions>[1];
      return NextResponse.json({ success: true, data: engine.listSessions(tenantId, status) });
    }
    if (action === 'session') {
      const sessionId = searchParams.get('sessionId');
      if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
      return NextResponse.json({ success: true, data: engine.getSession(sessionId) });
    }
    if (action === 'interventions') {
      const resolved = searchParams.get('resolved');
      return NextResponse.json({ success: true, data: engine.listInterventions(resolved === null ? undefined : resolved === 'true') });
    }
    if (action === 'templates') {
      return NextResponse.json({ success: true, data: engine.listTemplates() });
    }
    if (action === 'provisioning_log') {
      const sessionId = searchParams.get('sessionId');
      if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
      return NextResponse.json({ success: true, data: engine.getProvisioningLog(sessionId) });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const engine = getOnboardingEngine();

    if (action === 'register_template') {
      engine.registerTemplate(body.template);
      return NextResponse.json({ success: true });
    }
    if (action === 'start') {
      const session = engine.startOnboarding(body);
      return NextResponse.json({ success: true, data: session });
    }
    if (action === 'complete_step') {
      const ok = engine.completeStep(body.sessionId, body.stepId, body.autoProvision ?? false);
      return NextResponse.json({ success: ok });
    }
    if (action === 'skip_step') {
      const ok = engine.skipStep(body.sessionId, body.stepId, body.reason ?? '');
      return NextResponse.json({ success: ok });
    }
    if (action === 'update_integration') {
      engine.updateIntegrationHealth(body.sessionId, body.integrationName, body.health);
      return NextResponse.json({ success: true });
    }
    if (action === 'resolve_intervention') {
      const ok = engine.resolveIntervention(body.interventionId);
      return NextResponse.json({ success: ok });
    }
    if (action === 'detect_stalled') {
      const interventions = engine.detectStalledSessions(body.thresholdDays ?? 3);
      return NextResponse.json({ success: true, data: interventions });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
