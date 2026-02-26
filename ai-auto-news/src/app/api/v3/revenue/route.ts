import { NextRequest, NextResponse } from 'next/server';
import { getRevenueOptimizationEngine } from '@/lib/revenueOptimizationEngine';

export async function GET(request: NextRequest) {
  const engine = getRevenueOptimizationEngine();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'metrics';

  switch (action) {
    case 'metrics':
      return NextResponse.json(engine.getRevenueMetrics());

    case 'segments':
      return NextResponse.json(engine.getSegments());

    case 'funnels':
      return NextResponse.json(engine.getFunnels());

    case 'experiments':
      return NextResponse.json(engine.getExperiments(searchParams.get('status') || undefined));

    case 'projections': {
      const mrr = Number(searchParams.get('mrr') || '10000');
      const growth = Number(searchParams.get('growth') || '0.1');
      const months = Number(searchParams.get('months') || '12');
      return NextResponse.json(engine.projectRevenue(mrr, growth, months));
    }

    case 'optimize':
      return NextResponse.json(
        Object.fromEntries(engine.optimizeSegmentStrategies()),
      );

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const engine = getRevenueOptimizationEngine();
  const body = await request.json();
  const action = body.action;

  switch (action) {
    case 'create_segment': {
      const segment = engine.createSegment(body.data);
      return NextResponse.json(segment, { status: 201 });
    }

    case 'create_funnel': {
      const funnel = engine.createFunnel(body.name, body.stages);
      return NextResponse.json(funnel, { status: 201 });
    }

    case 'start_experiment': {
      const experiment = engine.startPricingExperiment(body.data);
      return NextResponse.json(experiment, { status: 201 });
    }

    case 'record_experiment': {
      const success = engine.recordExperimentEvent(
        body.experimentId,
        body.variantId,
        body.converted,
        body.revenue || 0,
      );
      return NextResponse.json({ success });
    }

    case 'conclude_experiment': {
      const result = engine.concludeExperiment(body.experimentId);
      if (!result) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
      return NextResponse.json(result);
    }

    case 'track_event':
      engine.trackUserEvent(body.userId, body.event, body.revenue || 0);
      return NextResponse.json({ success: true });

    case 'cohort_analysis': {
      const analysis = engine.generateCohortAnalysis(body.cohortMonth, body.userIds);
      return NextResponse.json(analysis);
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}
