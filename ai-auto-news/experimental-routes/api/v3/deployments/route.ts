import { NextRequest, NextResponse } from 'next/server';
import { getCanaryDeploymentEngine } from '@/lib/canaryDeploymentEngine';

export async function GET(request: NextRequest) {
  const engine = getCanaryDeploymentEngine();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'active';

  switch (action) {
    case 'active':
      return NextResponse.json(engine.getActiveDeployments());

    case 'history':
      return NextResponse.json(engine.getDeploymentHistory(
        searchParams.get('service') || undefined,
        Number(searchParams.get('limit') || '20'),
      ));

    case 'stats':
      return NextResponse.json(engine.getDeploymentStats());

    case 'detail': {
      const id = searchParams.get('id');
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const deployment = engine.getDeployment(id);
      if (!deployment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(deployment);
    }

    case 'events': {
      const id = searchParams.get('id');
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      return NextResponse.json(engine.getEvents(id));
    }

    case 'traffic': {
      const id = searchParams.get('id');
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      return NextResponse.json(engine.getCurrentTrafficSplit(id));
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const engine = getCanaryDeploymentEngine();
  const body = await request.json();
  const action = body.action;

  switch (action) {
    case 'create': {
      const deployment = engine.createDeployment(body.data);
      return NextResponse.json(deployment, { status: 201 });
    }

    case 'start':
      return NextResponse.json({ success: engine.startDeployment(body.deploymentId) });

    case 'advance':
      return NextResponse.json({ success: engine.advancePhase(body.deploymentId) });

    case 'rollback':
      return NextResponse.json({ success: engine.rollback(body.deploymentId, body.reason) });

    case 'metrics':
      return NextResponse.json({ success: engine.recordMetrics(body.deploymentId, body.metrics) });

    case 'evaluate': {
      const comparison = engine.evaluatePhase(body.deploymentId);
      if (!comparison) return NextResponse.json({ error: 'No active phase' }, { status: 400 });
      return NextResponse.json(comparison);
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}
