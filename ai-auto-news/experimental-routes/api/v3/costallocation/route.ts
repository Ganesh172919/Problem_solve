import { NextRequest, NextResponse } from 'next/server';
import { getCostAllocator } from '../../../../lib/realTimeCostAllocator';

const allocator = getCostAllocator();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') ?? 'summary';
  const tenantId = searchParams.get('tenantId') ?? undefined;
  const category = searchParams.get('category') as Parameters<typeof allocator.listLineItems>[1];
  const dimensionId = searchParams.get('dimensionId') ?? undefined;
  const activeOnly = searchParams.get('activeOnly') === 'true';
  const invoiceId = searchParams.get('invoiceId') ?? undefined;

  try {
    if (action === 'summary') return NextResponse.json(allocator.getSummary());
    if (action === 'dimensions') return NextResponse.json(allocator.listDimensions(tenantId));
    if (action === 'line_items') return NextResponse.json(allocator.listLineItems(tenantId, category));
    if (action === 'allocations') return NextResponse.json(allocator.listAllocations(tenantId, dimensionId));
    if (action === 'budgets') return NextResponse.json(allocator.listBudgets(tenantId));
    if (action === 'anomalies') return NextResponse.json(allocator.listAnomalies(tenantId, activeOnly));
    if (action === 'invoices') return NextResponse.json(allocator.listInvoices(tenantId));
    if (action === 'invoice' && invoiceId) {
      const inv = allocator.listInvoices(tenantId).find(i => i.id === invoiceId);
      if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      return NextResponse.json(inv);
    }
    if (action === 'breakdown' && tenantId) {
      const periodStart = Number(searchParams.get('periodStart') ?? Date.now() - 30 * 86_400_000);
      const periodEnd = Number(searchParams.get('periodEnd') ?? Date.now());
      return NextResponse.json(allocator.getSpendBreakdown(tenantId, periodStart, periodEnd));
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action } = body;

    if (action === 'create_dimension') {
      return NextResponse.json(allocator.createDimension(body as Parameters<typeof allocator.createDimension>[0]), { status: 201 });
    }
    if (action === 'ingest_line_item') {
      return NextResponse.json(allocator.ingestLineItem(body as Parameters<typeof allocator.ingestLineItem>[0]), { status: 201 });
    }
    if (action === 'allocate') {
      const { tenantId, periodStart, periodEnd } = body as { tenantId: string; periodStart: number; periodEnd: number };
      return NextResponse.json(allocator.allocateCosts(tenantId, periodStart, periodEnd));
    }
    if (action === 'create_budget') {
      return NextResponse.json(allocator.createBudget(body as Parameters<typeof allocator.createBudget>[0]), { status: 201 });
    }
    if (action === 'generate_invoice') {
      const { tenantId, periodStart, periodEnd } = body as { tenantId: string; periodStart: number; periodEnd: number };
      return NextResponse.json(allocator.generateInvoice(tenantId, periodStart, periodEnd), { status: 201 });
    }
    if (action === 'issue_invoice') {
      const { id } = body as { id: string };
      return NextResponse.json(allocator.issueInvoice(id));
    }
    if (action === 'resolve_anomaly') {
      const { id } = body as { id: string };
      allocator.resolveAnomaly(id);
      return NextResponse.json({ resolved: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
