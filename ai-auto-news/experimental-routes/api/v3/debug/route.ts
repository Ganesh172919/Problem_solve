import { NextRequest, NextResponse } from 'next/server';
import { getDebuggingEngine } from '../../../../lib/autonomousDebuggingEngine';

const engine = getDebuggingEngine();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const errorId = searchParams.get('errorId');
  const sessionId = searchParams.get('sessionId');
  const tenantId = searchParams.get('tenantId');
  const severity = searchParams.get('severity') as Parameters<typeof engine.listErrors>[1];
  const status = searchParams.get('status') as Parameters<typeof engine.listSessions>[1];

  try {
    if (action === 'summary') return NextResponse.json(engine.getDashboardSummary());
    if (action === 'errors') return NextResponse.json(engine.listErrors(tenantId ?? undefined, severity));
    if (action === 'error' && errorId) {
      const e = engine.getError(errorId);
      if (!e) return NextResponse.json({ error: 'Error not found' }, { status: 404 });
      return NextResponse.json(e);
    }
    if (action === 'sessions') return NextResponse.json(engine.listSessions(tenantId ?? undefined, status));
    if (action === 'session' && sessionId) {
      const s = engine.getSession(sessionId);
      if (!s) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      return NextResponse.json(s);
    }
    if (action === 'root_causes' && errorId) return NextResponse.json(engine.analyzeRootCause(errorId));
    if (action === 'fixes' && errorId) return NextResponse.json(engine.generateFixes(errorId));
    if (action === 'correlations' && errorId) return NextResponse.json(engine.detectCorrelations(errorId));
    if (action === 'report' && sessionId) return NextResponse.json(engine.generateReport(sessionId));
    if (action === 'memory_profile') return NextResponse.json(engine.captureMemoryProfile());
    if (action === 'memory_profiles') return NextResponse.json(engine.listMemoryProfiles());
    if (action === 'anomalies') return NextResponse.json(engine.listPerformanceAnomalies());
    if (action === 'patterns') return NextResponse.json(engine.listPatterns());
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'ingest_error') {
      const event = engine.ingestError(body as Parameters<typeof engine.ingestError>[0]);
      return NextResponse.json(event, { status: 201 });
    }
    if (action === 'open_session') {
      const { errorId, tenantId, assignedTo } = body as { errorId: string; tenantId: string; assignedTo?: string };
      const session = engine.openSession(errorId, tenantId, assignedTo);
      return NextResponse.json(session, { status: 201 });
    }
    if (action === 'apply_fix') {
      const { sessionId, fixId, appliedBy } = body as { sessionId: string; fixId: string; appliedBy: string };
      return NextResponse.json(engine.applyFix(sessionId, fixId, appliedBy));
    }
    if (action === 'resolve_session') {
      const { sessionId, summary, resolvedBy } = body as { sessionId: string; summary: string; resolvedBy: string };
      return NextResponse.json(engine.resolveSession(sessionId, summary, resolvedBy));
    }
    if (action === 'escalate_session') {
      const { sessionId, reason, escalatedTo } = body as { sessionId: string; reason: string; escalatedTo: string };
      return NextResponse.json(engine.escalateSession(sessionId, reason, escalatedTo));
    }
    if (action === 'add_note') {
      const { sessionId, note } = body as { sessionId: string; note: string };
      return NextResponse.json(engine.addNote(sessionId, note));
    }
    if (action === 'register_pattern') {
      const pattern = engine.registerPattern(body as Parameters<typeof engine.registerPattern>[0]);
      return NextResponse.json(pattern, { status: 201 });
    }
    if (action === 'register_anomaly') {
      const anomaly = engine.registerPerformanceAnomaly(body as Parameters<typeof engine.registerPerformanceAnomaly>[0]);
      return NextResponse.json(anomaly, { status: 201 });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
