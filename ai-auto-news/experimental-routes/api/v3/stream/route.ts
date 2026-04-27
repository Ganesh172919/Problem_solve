import { NextRequest, NextResponse } from 'next/server';
import { getStreamAggregator } from '../../../../lib/realtimeStreamAggregator';
import type { StreamDefinition, StreamEvent } from '../../../../lib/realtimeStreamAggregator';

const aggregator = getStreamAggregator();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const streamId = searchParams.get('streamId') ?? undefined;

  try {
    if (action === 'summary') return NextResponse.json(aggregator.getSummary());
    if (action === 'streams') return NextResponse.json(aggregator.listStreams());
    if (action === 'metrics' && streamId) {
      const m = aggregator.getMetrics(streamId);
      if (!m) return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
      return NextResponse.json(m);
    }
    if (action === 'results') {
      const limit = parseInt(searchParams.get('limit') ?? '100', 10);
      return NextResponse.json(aggregator.listResults(streamId, limit));
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

    if (action === 'register_stream') {
      aggregator.registerStream(body.stream as StreamDefinition);
      return NextResponse.json({ success: true });
    }
    if (action === 'ingest') {
      const event = body.event as StreamEvent;
      const results = aggregator.ingest(event);
      return NextResponse.json({ windowsEmitted: results.length, results });
    }
    if (action === 'ingest_batch') {
      const events = body.events as StreamEvent[];
      let totalEmitted = 0;
      const allResults = [];
      for (const ev of events) {
        const r = aggregator.ingest(ev);
        totalEmitted += r.length;
        allResults.push(...r);
      }
      return NextResponse.json({ eventsProcessed: events.length, windowsEmitted: totalEmitted, results: allResults });
    }
    if (action === 'join') {
      const results = aggregator.joinStreams(
        body.streamIdA as string, body.streamIdB as string,
        body.joinKeyFieldA as string, body.joinKeyFieldB as string,
        body.windowMs as number | undefined,
      );
      return NextResponse.json({ joinResults: results.length, results });
    }
    if (action === 'flush_window') {
      const result = aggregator.flushWindow(
        body.streamId as string, body.groupKey as string, body.windowStart as number
      );
      return NextResponse.json({ result });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
