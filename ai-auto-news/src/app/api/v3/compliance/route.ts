import { NextRequest, NextResponse } from 'next/server';
import { getComplianceMonitor } from '../../../../lib/realTimeComplianceMonitor';
import type { ComplianceFramework, ViolationStatus } from '../../../../lib/realTimeComplianceMonitor';

const monitor = getComplianceMonitor();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const tenantId = searchParams.get('tenantId') ?? undefined;
  const framework = (searchParams.get('framework') ?? undefined) as ComplianceFramework | undefined;
  const status = (searchParams.get('status') ?? undefined) as ViolationStatus | undefined;

  try {
    if (action === 'summary') return NextResponse.json(monitor.getSummary());
    if (action === 'posture' && tenantId) return NextResponse.json(monitor.getTenantPosture(tenantId));
    if (action === 'controls') return NextResponse.json(monitor.listControls(tenantId, framework));
    if (action === 'violations') return NextResponse.json(monitor.listViolations(tenantId, status));
    if (action === 'tasks') return NextResponse.json(monitor.listRemediationTasks(tenantId));
    if (action === 'report' && tenantId && framework) {
      return NextResponse.json(monitor.generateAuditReport(tenantId, framework));
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = (body.action as string) ?? '';

    if (action === 'register_control') {
      monitor.registerControl(body.control as Parameters<typeof monitor.registerControl>[0]);
      return NextResponse.json({ success: true });
    }
    if (action === 'assess') {
      const status = monitor.assessControl(body.controlId as string, body.evidenceItems as Parameters<typeof monitor.assessControl>[1]);
      return NextResponse.json({ status });
    }
    if (action === 'record_violation') {
      monitor.recordViolation(body.violation as Parameters<typeof monitor.recordViolation>[0]);
      return NextResponse.json({ success: true });
    }
    if (action === 'acknowledge') {
      const ok = monitor.acknowledgeViolation(body.violationId as string);
      return NextResponse.json({ success: ok });
    }
    if (action === 'remediate') {
      const ok = monitor.remediateViolation(body.violationId as string);
      return NextResponse.json({ success: ok });
    }
    if (action === 'consent') {
      monitor.recordConsent(body.consent as Parameters<typeof monitor.recordConsent>[0]);
      return NextResponse.json({ success: true });
    }
    if (action === 'revoke_consent') {
      const ok = monitor.revokeConsent(body.consentId as string);
      return NextResponse.json({ success: ok });
    }
    if (action === 'collect_evidence') {
      const item = monitor.collectEvidence(body.controlId as string, body.sourceSystem as string, body.dataSnapshot as string);
      return NextResponse.json(item);
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
