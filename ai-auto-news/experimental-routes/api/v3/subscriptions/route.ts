import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getSubscriptionManager } from '@/lib/subscriptionLifecycleManager';
import { getSubscriptionAgent } from '@/agents/subscriptionAgent';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const tenantId = searchParams.get('tenantId');

  try {
    const manager = getSubscriptionManager();
    const agent = getSubscriptionAgent();

    if (action === 'plans') {
      const plans = manager.listPlans();
      return NextResponse.json({ success: true, data: { plans } });
    }

    if (action === 'metrics') {
      const metrics = agent.getRevenueMetrics();
      return NextResponse.json({ success: true, data: { metrics } });
    }

    if (action === 'events') {
      const events = manager.getEvents(tenantId as string);
      return NextResponse.json({ success: true, data: { tenantId, events } });
    }

    const subscription = manager.getSubscription(tenantId as string);
    return NextResponse.json({ success: true, data: { tenantId, subscription } });
  } catch (err) {
    logger.error('Subscriptions GET error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action as string;

    const manager = getSubscriptionManager();
    const agent = getSubscriptionAgent();

    if (action === 'create') {
      const subscription = await agent.createSubscription(body.tenantId as string, body.planId as string);
      return NextResponse.json({ success: true, data: { subscription } });
    }

    if (action === 'upgrade') {
      const result = await agent.upgradeSubscription(body.tenantId as string, body.planId as string);
      return NextResponse.json({ success: true, data: { result } });
    }

    if (action === 'downgrade') {
      const result = await agent.downgradeSubscription(body.tenantId as string, body.planId as string);
      return NextResponse.json({ success: true, data: { result } });
    }

    if (action === 'cancel') {
      await manager.cancelSubscription(body.tenantId as string);
      return NextResponse.json({ success: true, data: { message: 'Subscription cancelled' } });
    }

    if (action === 'pause') {
      manager.pauseSubscription(body.tenantId as string);
      return NextResponse.json({ success: true, data: { message: 'Subscription paused' } });
    }

    if (action === 'resume') {
      manager.resumeSubscription(body.tenantId as string);
      return NextResponse.json({ success: true, data: { message: 'Subscription resumed' } });
    }

    return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    logger.error('Subscriptions POST error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
