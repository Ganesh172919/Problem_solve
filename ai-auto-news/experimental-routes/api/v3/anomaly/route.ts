import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getAnomalyDetector } from '@/lib/realtimeAnomalyDetector';
import { getAnomalyResponseAgent } from '@/agents/anomalyResponseAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const streamId = searchParams.get('streamId');
  const action = searchParams.get('action');

  try {
    const detector = getAnomalyDetector();
    const agent = getAnomalyResponseAgent();

    if (streamId && action === 'health') {
      const health = detector.getStreamHealth(streamId);
      return NextResponse.json({ success: true, data: { health } });
    }

    if (streamId && action === 'history') {
      const limit = parseInt(searchParams.get('limit') ?? '100', 10);
      const history = detector.getAnomalyHistory(streamId, limit);
      return NextResponse.json({ success: true, data: { history } });
    }

    if (action === 'alerts') {
      const openAlerts = detector.getOpenAlerts();
      return NextResponse.json({ success: true, data: { openAlerts } });
    }

    if (action === 'incidents') {
      const openIncidents = agent.getOpenIncidents();
      return NextResponse.json({ success: true, data: { openIncidents } });
    }

    const dashboard = detector.getDashboardSummary();
    const agentStats = agent.getStats();

    return NextResponse.json({ success: true, data: { dashboard, agentStats } });
  } catch (err) {
    logger.error('Anomaly GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;
    const detector = getAnomalyDetector();
    const agent = getAnomalyResponseAgent();

    if (action === 'create_stream') {
      const stream = detector.createStream(body.params as Parameters<typeof detector.createStream>[0]);
      return NextResponse.json({ success: true, data: { stream } });
    }

    if (action === 'ingest') {
      const { streamId, point } = body as { streamId: string; point: Parameters<typeof detector.ingest>[1] };
      const anomaly = detector.ingest(streamId, point);
      return NextResponse.json({ success: true, data: { anomaly } });
    }

    if (action === 'ingest_batch') {
      const { streamId, points } = body as { streamId: string; points: Parameters<typeof detector.ingestBatch>[1] };
      const anomalies = detector.ingestBatch(streamId, points);
      return NextResponse.json({ success: true, data: { anomalies, count: anomalies.length } });
    }

    if (action === 'acknowledge_alert') {
      const { alertId } = body as { alertId: string };
      detector.acknowledgeAlert(alertId);
      return NextResponse.json({ success: true, data: { message: 'Alert acknowledged' } });
    }

    if (action === 'resolve_alert') {
      const { alertId, resolution } = body as { alertId: string; resolution: string };
      detector.resolveAlert(alertId, resolution);
      return NextResponse.json({ success: true, data: { message: 'Alert resolved' } });
    }

    if (action === 'resolve_incident') {
      const { incidentId, resolution } = body as { incidentId: string; resolution: string };
      agent.resolveIncident(incidentId, resolution);
      return NextResponse.json({ success: true, data: { message: 'Incident resolved' } });
    }

    if (action === 'cluster') {
      const windowMs = (body.windowMs as number) ?? 60 * 60_000;
      const clusters = detector.clusterAnomalies(windowMs);
      return NextResponse.json({ success: true, data: { clusters, count: clusters.length } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Anomaly POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
