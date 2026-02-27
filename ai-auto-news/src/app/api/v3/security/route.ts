import { NextRequest, NextResponse } from 'next/server';
import { getAutonomousSecurityAgent } from '@/agents/autonomousSecurityAgent';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const agent = getAutonomousSecurityAgent();
  const { action } = body;

  try {
    switch (action) {
      case 'analyze': {
        const result = agent.analyzeRequest(body.request);
        return NextResponse.json({ success: true, data: result });
      }
      case 'scan': {
        const scan = agent.runSecurityScan(body.target, body.scanType, body.tenantId);
        return NextResponse.json({ success: true, data: scan });
      }
      case 'assess_vulnerabilities': {
        const assessment = agent.assessVulnerabilities(body.target);
        return NextResponse.json({ success: true, data: assessment });
      }
      case 'create_incident': {
        const incident = agent.createIncident(
          body.severity,
          body.summary,
          body.affectedSystems ?? [],
          body.affectedTenants ?? []
        );
        return NextResponse.json({ success: true, data: incident });
      }
      case 'resolve_incident': {
        agent.resolveIncident(body.incidentId, body.resolution, body.lessons ?? []);
        return NextResponse.json({ success: true });
      }
      case 'block_ip': {
        agent.blockIP(body.ip, body.reason, body.durationMs);
        return NextResponse.json({ success: true });
      }
      case 'unblock_ip': {
        agent.unblockIP(body.ip);
        return NextResponse.json({ success: true });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') ?? 'metrics';

  const agent = getAutonomousSecurityAgent();

  try {
    switch (action) {
      case 'metrics': {
        const metrics = agent.getMetrics();
        return NextResponse.json({ success: true, data: metrics });
      }
      case 'threats': {
        const threats = agent.getThreats({
          status: searchParams.get('status') as 'active' | 'mitigated' | undefined,
          severity: searchParams.get('severity') as 'critical' | 'high' | undefined,
        });
        return NextResponse.json({ success: true, data: threats });
      }
      case 'incidents': {
        const status = searchParams.get('status') as 'open' | 'resolved' | undefined;
        const incidents = agent.getIncidents(status);
        return NextResponse.json({ success: true, data: incidents });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
