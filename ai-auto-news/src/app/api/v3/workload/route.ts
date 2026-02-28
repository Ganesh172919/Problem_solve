import { NextRequest, NextResponse } from 'next/server';
import { getWorkloadBalancer } from '../../../../lib/intelligentWorkloadBalancer';

const balancer = getWorkloadBalancer();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const nodeId = searchParams.get('nodeId') ?? undefined;

  try {
    if (action === 'summary') return NextResponse.json(balancer.getSummary());
    if (action === 'nodes') return NextResponse.json(balancer.listNodes());
    if (action === 'node' && nodeId) {
      const node = balancer.getNode(nodeId);
      if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 });
      return NextResponse.json(node);
    }
    if (action === 'tasks') return NextResponse.json(balancer.listActiveTasks());
    if (action === 'queue') return NextResponse.json(balancer.listQueuedTasks());
    if (action === 'decisions') return NextResponse.json(balancer.listDecisions());
    if (action === 'rebalances') return NextResponse.json(balancer.listRebalanceHistory());
    if (action === 'hotspots') return NextResponse.json(balancer.getHotspotNodes());
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = (body.action as string) ?? '';

    if (action === 'register_node') {
      balancer.registerNode(body.node as Parameters<typeof balancer.registerNode>[0]);
      return NextResponse.json({ success: true });
    }
    if (action === 'enqueue_task') {
      const id = balancer.enqueueTask(body.task as Parameters<typeof balancer.enqueueTask>[0]);
      return NextResponse.json({ taskId: id });
    }
    if (action === 'schedule') {
      const decision = balancer.scheduleNextTask();
      return NextResponse.json({ decision });
    }
    if (action === 'complete_task') {
      const ok = balancer.completeTask(body.taskId as string, body.failed as boolean | undefined);
      return NextResponse.json({ success: ok });
    }
    if (action === 'rebalance') {
      const event = balancer.rebalance(body.reason as Parameters<typeof balancer.rebalance>[0]);
      return NextResponse.json(event);
    }
    if (action === 'set_algorithm') {
      balancer.setDefaultAlgorithm(body.algorithm as Parameters<typeof balancer.setDefaultAlgorithm>[0]);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
