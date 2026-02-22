import { NextRequest, NextResponse } from 'next/server';
import {
  getCostSummary,
  getOptimizationSuggestions,
  getPlatformCostDashboard,
  selectOptimalModel,
  estimateCost,
  getModelCosts,
  createBudget,
  getBudgetStatus,
  getCostEvents,
} from '@/lib/costRevenueOptimizer';

// GET /api/costs — Cost analytics and optimization
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') ?? 'summary';
    const userId = searchParams.get('userId');
    const tenantId = searchParams.get('tenantId');
    const days = parseInt(searchParams.get('days') ?? '30', 10);

    if (view === 'dashboard') {
      return NextResponse.json({ dashboard: getPlatformCostDashboard() });
    }

    if (view === 'models') {
      return NextResponse.json({ models: getModelCosts() });
    }

    if (view === 'estimate') {
      const model = searchParams.get('model') ?? 'gpt-4o-mini';
      const promptTokens = parseInt(searchParams.get('promptTokens') ?? '1000', 10);
      const completionTokens = parseInt(searchParams.get('completionTokens') ?? '500', 10);
      const costUsd = estimateCost(model, promptTokens, completionTokens);
      return NextResponse.json({ costUsd, model, promptTokens, completionTokens });
    }

    if (view === 'optimal_model') {
      const maxLatencyMs = searchParams.get('maxLatencyMs') ? parseInt(searchParams.get('maxLatencyMs')!, 10) : undefined;
      const minQuality = searchParams.get('minQuality') ? parseInt(searchParams.get('minQuality')!, 10) : undefined;
      const maxCost = searchParams.get('maxCostPer1kTokens') ? parseFloat(searchParams.get('maxCostPer1kTokens')!) : undefined;
      const model = selectOptimalModel({ maxLatencyMs, minQuality, maxCostPer1kTokens: maxCost });
      return NextResponse.json({ model });
    }

    if (view === 'budget') {
      const budgetId = searchParams.get('budgetId');
      if (!budgetId) return NextResponse.json({ error: 'budgetId required' }, { status: 400 });
      const status = getBudgetStatus(budgetId);
      if (!status) return NextResponse.json({ error: 'Budget not found' }, { status: 404 });
      return NextResponse.json({ status });
    }

    if (view === 'suggestions') {
      if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
      const suggestions = getOptimizationSuggestions(userId);
      return NextResponse.json({ suggestions });
    }

    if (view === 'events') {
      const events = getCostEvents({ userId: userId ?? undefined, tenantId: tenantId ?? undefined, limit: 100 });
      return NextResponse.json({ events, count: events.length });
    }

    // Default: summary
    const scopeType = userId ? 'user' : tenantId ? 'tenant' : 'global';
    const scopeId = userId ?? tenantId ?? 'platform';
    const summary = getCostSummary(scopeType, scopeId, days);
    return NextResponse.json({ summary });
  } catch (error) {
    console.error('Costs GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/costs — Create budget or record token usage
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      action?: string;
      budget?: Parameters<typeof createBudget>[0];
    };

    if (body.action === 'create_budget') {
      if (!body.budget) return NextResponse.json({ error: 'budget required' }, { status: 400 });
      const budget = createBudget(body.budget);
      return NextResponse.json({ budget }, { status: 201 });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Costs POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
