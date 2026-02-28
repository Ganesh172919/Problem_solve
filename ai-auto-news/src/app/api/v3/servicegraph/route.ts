import { NextRequest, NextResponse } from 'next/server';
import { getServiceGraph } from '../../../../lib/serviceGraphAnalyzer';

const graph = getServiceGraph();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const serviceId = searchParams.get('serviceId');
  const tenantId = searchParams.get('tenantId');
  const severity = searchParams.get('severity') as Parameters<typeof graph.listIssues>[0];

  try {
    if (action === 'summary') return NextResponse.json(graph.getDashboardSummary());
    if (action === 'services') return NextResponse.json(graph.listServices(tenantId ?? undefined));
    if (action === 'service' && serviceId) {
      const s = graph.getService(serviceId);
      if (!s) return NextResponse.json({ error: 'Service not found' }, { status: 404 });
      return NextResponse.json(s);
    }
    if (action === 'dependencies') return NextResponse.json(graph.listDependencies(serviceId ?? undefined));
    if (action === 'issues') return NextResponse.json(graph.listIssues(severity));
    if (action === 'blast_radius' && serviceId) return NextResponse.json(graph.computeBlastRadius(serviceId));
    if (action === 'critical_path') return NextResponse.json(graph.findCriticalPath());
    if (action === 'metrics') return NextResponse.json(graph.computeMetrics());
    if (action === 'mesh_policy' && serviceId) {
      const p = graph.getMeshPolicy(serviceId);
      if (!p) return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
      return NextResponse.json(p);
    }
    if (action === 'generate_policy' && serviceId) return NextResponse.json(graph.generateMeshPolicy(serviceId));
    if (action === 'direct_deps' && serviceId) return NextResponse.json(graph.getDirectDependencies(serviceId));
    if (action === 'direct_dependents' && serviceId) return NextResponse.json(graph.getDirectDependents(serviceId));
    if (action === 'version_compat') {
      const serviceAId = searchParams.get('serviceAId');
      const serviceBId = searchParams.get('serviceBId');
      if (!serviceAId || !serviceBId) return NextResponse.json({ error: 'serviceAId and serviceBId required' }, { status: 400 });
      return NextResponse.json(graph.checkVersionCompatibility(serviceAId, serviceBId));
    }
    if (action === 'detect_issues' && tenantId) return NextResponse.json(graph.detectAllIssues(tenantId));
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'register_service') {
      const service = graph.registerService(body as Parameters<typeof graph.registerService>[0]);
      return NextResponse.json(service, { status: 201 });
    }
    if (action === 'update_service') {
      const { serviceId, updates } = body as { serviceId: string; updates: Parameters<typeof graph.updateService>[1] };
      return NextResponse.json(graph.updateService(serviceId, updates));
    }
    if (action === 'update_health') {
      const { serviceId, status, score } = body as { serviceId: string; status: Parameters<typeof graph.updateHealth>[1]; score: number };
      graph.updateHealth(serviceId, status, score);
      return NextResponse.json({ ok: true });
    }
    if (action === 'add_dependency') {
      const dep = graph.addDependency(body as Parameters<typeof graph.addDependency>[0]);
      return NextResponse.json(dep, { status: 201 });
    }
    if (action === 'remove_dependency') {
      const { depId } = body as { depId: string };
      graph.removeDependency(depId);
      return NextResponse.json({ ok: true });
    }
    if (action === 'generate_mesh_policy') {
      const { serviceId } = body as { serviceId: string };
      return NextResponse.json(graph.generateMeshPolicy(serviceId));
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
