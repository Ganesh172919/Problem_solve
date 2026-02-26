import { NextRequest, NextResponse } from 'next/server';
import { getCapacityPlanningEngine } from '@/lib/capacityPlanningEngine';

export async function GET(request: NextRequest) {
  const engine = getCapacityPlanningEngine();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'plan';

  switch (action) {
    case 'plan': {
      const plan = engine.generatePlan('Auto-generated capacity plan');
      return NextResponse.json(plan);
    }

    case 'bottlenecks':
      return NextResponse.json(engine.analyzeBottlenecks());

    case 'forecast': {
      const resourceType = searchParams.get('resource') as Parameters<typeof engine.forecast>[0];
      const name = searchParams.get('name') || 'default';
      if (!resourceType) return NextResponse.json({ error: 'resource required' }, { status: 400 });
      return NextResponse.json(engine.forecast(resourceType, name));
    }

    case 'plans':
      return NextResponse.json(engine.getPlans());

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const engine = getCapacityPlanningEngine();
  const body = await request.json();
  const action = body.action;

  switch (action) {
    case 'record_metric':
      engine.recordMetric(body.metric);
      return NextResponse.json({ success: true });

    case 'scenario': {
      const plan = engine.modelGrowthScenario(body.scenario);
      return NextResponse.json(plan);
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}
