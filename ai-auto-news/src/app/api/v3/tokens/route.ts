import { NextRequest, NextResponse } from 'next/server';
import { getTokenBudgetManager } from '@/lib/tokenBudgetManager';

export async function GET(request: NextRequest) {
  const manager = getTokenBudgetManager();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'budgets';

  switch (action) {
    case 'budgets': {
      const tenantId = searchParams.get('tenantId');
      return NextResponse.json(manager.getAllBudgets(tenantId || undefined));
    }

    case 'budget': {
      const budgetId = searchParams.get('budgetId');
      if (!budgetId) return NextResponse.json({ error: 'budgetId required' }, { status: 400 });
      const budget = manager.getBudget(budgetId);
      if (!budget) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
      return NextResponse.json(budget);
    }

    case 'forecast': {
      const budgetId = searchParams.get('budgetId');
      if (!budgetId) return NextResponse.json({ error: 'budgetId required' }, { status: 400 });
      const forecast = manager.forecast(budgetId);
      if (!forecast) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
      return NextResponse.json(forecast);
    }

    case 'cost_report': {
      const budgetId = searchParams.get('budgetId');
      if (!budgetId) return NextResponse.json({ error: 'budgetId required' }, { status: 400 });
      const report = manager.generateCostReport(budgetId);
      if (!report) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
      return NextResponse.json(report);
    }

    case 'usage': {
      const budgetId = searchParams.get('budgetId');
      if (!budgetId) return NextResponse.json({ error: 'budgetId required' }, { status: 400 });
      return NextResponse.json(manager.getUsageRecords(budgetId, Number(searchParams.get('limit') || '50')));
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const manager = getTokenBudgetManager();
  const body = await request.json();
  const action = body.action;

  switch (action) {
    case 'create_budget': {
      const budget = manager.createBudget(body.data);
      return NextResponse.json(budget, { status: 201 });
    }

    case 'record_usage': {
      const record = manager.recordUsage(body.data);
      if (!record) return NextResponse.json({ error: 'Usage recording failed - budget exceeded or not found' }, { status: 400 });
      return NextResponse.json(record);
    }

    case 'reserve': {
      const reservationId = manager.reserveTokens(body.budgetId, body.tokens, body.durationMs);
      if (!reservationId) return NextResponse.json({ error: 'Reservation failed' }, { status: 400 });
      return NextResponse.json({ reservationId });
    }

    case 'release': {
      const released = manager.releaseReservation(body.reservationId);
      return NextResponse.json({ success: released });
    }

    case 'optimize_model': {
      const model = manager.optimizeModelSelection(body.operation, body.capabilities, body.budgetId);
      return NextResponse.json({ model });
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
}
