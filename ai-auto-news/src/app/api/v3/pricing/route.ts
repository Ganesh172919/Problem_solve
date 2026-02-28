import { NextRequest, NextResponse } from 'next/server';
import { getDynamicPricingOptimizer } from '../../../../lib/dynamicPricingOptimizer';
import type { PricingPolicy, DemandSignal, Discount, PriceExperiment } from '../../../../lib/dynamicPricingOptimizer';

const optimizer = getDynamicPricingOptimizer();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const policyId = searchParams.get('policyId') ?? undefined;
  const tenantId = searchParams.get('tenantId') ?? undefined;

  try {
    if (action === 'summary') return NextResponse.json(optimizer.getSummary());
    if (action === 'policies') return NextResponse.json(optimizer.listPolicies(tenantId));
    if (action === 'policy' && policyId) {
      const p = optimizer.getPolicy(policyId);
      if (!p) return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
      return NextResponse.json(p);
    }
    if (action === 'adjustments') {
      const limit = parseInt(searchParams.get('limit') ?? '100', 10);
      return NextResponse.json(optimizer.listAdjustmentHistory(policyId, limit));
    }
    if (action === 'discounts') {
      const active = searchParams.get('active');
      return NextResponse.json(optimizer.listDiscounts(active === null ? undefined : active === 'true'));
    }
    if (action === 'experiments') {
      const status = searchParams.get('status') as PriceExperiment['status'] | null;
      return NextResponse.json(optimizer.listExperiments(status ?? undefined));
    }
    if (action === 'price_for_user' && policyId) {
      const userId = searchParams.get('userId');
      if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
      return NextResponse.json({ priceCents: optimizer.getPricingForUser(policyId, userId) });
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

    if (action === 'register_policy') {
      optimizer.registerPolicy(body.policy as PricingPolicy);
      return NextResponse.json({ success: true });
    }
    if (action === 'update_policy') {
      const id = body.policyId as string;
      const updated = optimizer.updatePolicy(id, body.updates as Partial<PricingPolicy>);
      return NextResponse.json({ success: updated });
    }
    if (action === 'ingest_demand') {
      optimizer.ingestDemandSignal(body.signal as DemandSignal);
      return NextResponse.json({ success: true });
    }
    if (action === 'optimize') {
      const id = body.policyId as string;
      const event = optimizer.optimizePrice(id);
      return NextResponse.json({ event: event ?? null, optimized: event !== null });
    }
    if (action === 'create_discount') {
      optimizer.createDiscount(body.discount as Discount);
      return NextResponse.json({ success: true });
    }
    if (action === 'apply_discount') {
      const result = optimizer.applyDiscount(body.discountId as string);
      if (!result) return NextResponse.json({ error: 'Discount not applicable' }, { status: 400 });
      return NextResponse.json(result);
    }
    if (action === 'start_experiment') {
      optimizer.startExperiment(body.experiment as PriceExperiment);
      return NextResponse.json({ success: true });
    }
    if (action === 'record_conversion') {
      const ok = optimizer.recordExperimentConversion(
        body.experimentId as string, body.isVariant as boolean, body.revenueCents as number
      );
      return NextResponse.json({ success: ok });
    }
    if (action === 'conclude_experiment') {
      const exp = optimizer.concludeExperiment(body.experimentId as string);
      if (!exp) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 });
      return NextResponse.json(exp);
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
