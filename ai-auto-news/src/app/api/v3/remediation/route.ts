import { NextRequest, NextResponse } from 'next/server';
import { getRemediationEngine } from '../../../../lib/autonomousRemediationEngine';

const engine = getRemediationEngine();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const incidentId = searchParams.get('incidentId') ?? undefined;
  const executionId = searchParams.get('executionId') ?? undefined;

  try {
    if (action === 'summary') return NextResponse.json(engine.getSummary());
    if (action === 'incidents') {
      const status = searchParams.get('status') as Parameters<typeof engine.listIncidents>[0] | null;
      return NextResponse.json(engine.listIncidents(status ?? undefined));
    }
    if (action === 'incident' && incidentId) {
      const incident = engine.getIncident(incidentId);
      if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
      return NextResponse.json(incident);
    }
    if (action === 'playbooks') return NextResponse.json(engine.listPlaybooks());
    if (action === 'executions') return NextResponse.json(engine.listExecutions(incidentId));
    if (action === 'execution' && executionId) {
      const exec = engine.getExecution(executionId);
      if (!exec) return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
      return NextResponse.json(exec);
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

    if (action === 'create_incident') {
      engine.createIncident(body.incident as Parameters<typeof engine.createIncident>[0]);
      return NextResponse.json({ success: true });
    }
    if (action === 'register_playbook') {
      engine.registerPlaybook(body.playbook as Parameters<typeof engine.registerPlaybook>[0]);
      return NextResponse.json({ success: true });
    }
    if (action === 'analyze_rca') {
      const hypotheses = engine.analyzeRootCause(body.incidentId as string);
      return NextResponse.json({ hypotheses });
    }
    if (action === 'execute') {
      const exec = await engine.executeRemediation(
        body.incidentId as string,
        body.playbookId as string,
        { dryRun: body.dryRun as boolean | undefined, executedBy: body.executedBy as string | undefined }
      );
      return NextResponse.json(exec);
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
