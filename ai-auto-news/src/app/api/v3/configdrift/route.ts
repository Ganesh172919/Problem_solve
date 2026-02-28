import { NextRequest, NextResponse } from 'next/server';
import { getConfigDriftDetector } from '../../../../lib/autonomousConfigDriftDetector';

const detector = getConfigDriftDetector();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const tenantId = searchParams.get('tenantId') ?? undefined;
  const serviceId = searchParams.get('serviceId') ?? undefined;
  const reportId = searchParams.get('reportId') ?? undefined;
  const environment = searchParams.get('environment') ?? undefined;

  try {
    if (action === 'summary') return NextResponse.json(detector.getSummary());
    if (action === 'baselines') return NextResponse.json(detector.listBaselines(tenantId));
    if (action === 'baseline') {
      const id = searchParams.get('id');
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const b = detector.getBaseline(id);
      if (!b) return NextResponse.json({ error: 'Baseline not found' }, { status: 404 });
      return NextResponse.json(b);
    }
    if (action === 'active_baseline' && tenantId && serviceId && environment) {
      const b = detector.getActiveBaseline(tenantId, serviceId, environment);
      if (!b) return NextResponse.json({ error: 'No active baseline' }, { status: 404 });
      return NextResponse.json(b);
    }
    if (action === 'reports') return NextResponse.json(detector.listReports(tenantId, serviceId));
    if (action === 'report' && reportId) {
      const r = detector.getReport(reportId);
      if (!r) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      return NextResponse.json(r);
    }
    if (action === 'snapshots') return NextResponse.json(detector.listSnapshots(tenantId, serviceId));
    if (action === 'remediations') {
      const status = searchParams.get('status') as Parameters<typeof detector.listRemediations>[1];
      return NextResponse.json(detector.listRemediations(tenantId, status));
    }
    if (action === 'policies') return NextResponse.json(detector.listPolicies(tenantId));
    if (action === 'velocity' && tenantId && serviceId && environment) {
      return NextResponse.json(detector.getChangeVelocity(tenantId, serviceId, environment));
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

    if (action === 'capture_baseline') {
      return NextResponse.json(detector.captureBaseline(body as Parameters<typeof detector.captureBaseline>[0]), { status: 201 });
    }
    if (action === 'detect_drift') {
      return NextResponse.json(detector.detectDrift(body as Parameters<typeof detector.detectDrift>[0]), { status: 201 });
    }
    if (action === 'create_remediation') {
      const { reportId, approvedBy } = body as { reportId: string; approvedBy?: string };
      return NextResponse.json(detector.createRemediation(reportId, approvedBy), { status: 201 });
    }
    if (action === 'apply_remediation') {
      const { id } = body as { id: string };
      return NextResponse.json(detector.applyRemediation(id));
    }
    if (action === 'rollback_remediation') {
      const { id } = body as { id: string };
      return NextResponse.json(detector.rollbackRemediation(id));
    }
    if (action === 'create_policy') {
      return NextResponse.json(detector.createCompliancePolicy(body as Parameters<typeof detector.createCompliancePolicy>[0]), { status: 201 });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
