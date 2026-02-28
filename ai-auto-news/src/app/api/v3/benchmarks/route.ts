import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getBenchmarkingEngine } from '@/lib/performanceBenchmarkingEngine';
import { getBenchmarkingAgent } from '@/agents/benchmarkingAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    const engine = getBenchmarkingEngine();
    const agent = getBenchmarkingAgent();

    if (action === 'stats') {
      const stats = engine.getStats();
      return NextResponse.json({ success: true, data: { stats } });
    }

    if (action === 'results') {
      const suiteId = searchParams.get('suiteId') as string;
      const results = engine.getResults(suiteId);
      return NextResponse.json({ success: true, data: { suiteId, results } });
    }

    if (action === 'trend') {
      const benchmarkId = searchParams.get('benchmarkId') as string;
      const trend = engine.getTrend(benchmarkId);
      return NextResponse.json({ success: true, data: { benchmarkId, trend } });
    }

    const suites = agent.listSuites();
    return NextResponse.json({ success: true, data: { suites } });
  } catch (err) {
    logger.error('Benchmarks GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;

    const engine = getBenchmarkingEngine();
    const agent = getBenchmarkingAgent();

    if (action === 'register') {
      const suite = body.suite as Parameters<typeof engine.registerSuite>[0];
      const registered = engine.registerSuite(suite);
      return NextResponse.json({ success: true, data: { suite: registered } });
    }

    if (action === 'run') {
      const result = await agent.runSuite(body.suiteId as string);
      return NextResponse.json({ success: true, data: { result } });
    }

    if (action === 'compare') {
      const comparison = engine.compareResults(
        body.resultIdA as string,
        body.resultIdB as string,
      );
      return NextResponse.json({ success: true, data: { comparison } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Benchmarks POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
