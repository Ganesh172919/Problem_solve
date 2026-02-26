/**
 * Token Budget Manager
 *
 * Intelligent token allocation, usage tracking, and cost optimization
 * for AI model interactions with budget enforcement and forecasting.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface TokenBudget {
  id: string;
  tenantId: string;
  name: string;
  totalTokens: number;
  usedTokens: number;
  reservedTokens: number;
  periodStart: number;
  periodEnd: number;
  alertThresholds: number[];
  hardLimit: boolean;
  rolloverEnabled: boolean;
  rolloverPercent: number;
}

export interface TokenUsageRecord {
  id: string;
  budgetId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  operationType: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export interface ModelPricing {
  model: string;
  promptPricePerToken: number;
  completionPricePerToken: number;
  contextWindow: number;
  maxOutput: number;
}

export interface BudgetForecast {
  projectedUsage: number;
  projectedCost: number;
  daysRemaining: number;
  burnRate: number;
  willExceedBudget: boolean;
  estimatedExhaustionDate: number | null;
  recommendations: string[];
}

export interface AllocationStrategy {
  type: 'fixed' | 'proportional' | 'priority' | 'dynamic';
  weights?: Record<string, number>;
  priorities?: Record<string, number>;
  reservePercent: number;
}

export interface CostReport {
  periodStart: number;
  periodEnd: number;
  totalTokens: number;
  totalCost: number;
  byModel: Record<string, { tokens: number; cost: number }>;
  byOperation: Record<string, { tokens: number; cost: number }>;
  dailyBreakdown: { date: string; tokens: number; cost: number }[];
  efficiency: number;
}

const DEFAULT_PRICING: ModelPricing[] = [
  {
    model: 'gpt-4',
    promptPricePerToken: 0.00003,
    completionPricePerToken: 0.00006,
    contextWindow: 8192,
    maxOutput: 4096,
  },
  {
    model: 'gpt-4-turbo',
    promptPricePerToken: 0.00001,
    completionPricePerToken: 0.00003,
    contextWindow: 128000,
    maxOutput: 4096,
  },
  {
    model: 'gpt-3.5-turbo',
    promptPricePerToken: 0.0000005,
    completionPricePerToken: 0.0000015,
    contextWindow: 16385,
    maxOutput: 4096,
  },
  {
    model: 'claude-3-opus',
    promptPricePerToken: 0.000015,
    completionPricePerToken: 0.000075,
    contextWindow: 200000,
    maxOutput: 4096,
  },
  {
    model: 'claude-3-sonnet',
    promptPricePerToken: 0.000003,
    completionPricePerToken: 0.000015,
    contextWindow: 200000,
    maxOutput: 4096,
  },
  {
    model: 'gemini-pro',
    promptPricePerToken: 0.00000025,
    completionPricePerToken: 0.0000005,
    contextWindow: 32000,
    maxOutput: 8192,
  },
];

export class TokenBudgetManager {
  private budgets: Map<string, TokenBudget> = new Map();
  private usageRecords: TokenUsageRecord[] = [];
  private pricing: Map<string, ModelPricing> = new Map();
  private alertCallbacks: Map<string, ((budget: TokenBudget, threshold: number) => void)[]> = new Map();
  private reservations: Map<string, { budgetId: string; tokens: number; expiresAt: number }> = new Map();

  constructor() {
    for (const p of DEFAULT_PRICING) {
      this.pricing.set(p.model, p);
    }
  }

  createBudget(params: {
    tenantId: string;
    name: string;
    totalTokens: number;
    periodDays?: number;
    alertThresholds?: number[];
    hardLimit?: boolean;
    rolloverEnabled?: boolean;
    rolloverPercent?: number;
  }): TokenBudget {
    const now = Date.now();
    const periodDays = params.periodDays || 30;

    const budget: TokenBudget = {
      id: `budget_${now}_${Math.random().toString(36).substring(2, 10)}`,
      tenantId: params.tenantId,
      name: params.name,
      totalTokens: params.totalTokens,
      usedTokens: 0,
      reservedTokens: 0,
      periodStart: now,
      periodEnd: now + periodDays * 24 * 60 * 60 * 1000,
      alertThresholds: params.alertThresholds || [0.5, 0.75, 0.9],
      hardLimit: params.hardLimit ?? true,
      rolloverEnabled: params.rolloverEnabled ?? false,
      rolloverPercent: params.rolloverPercent ?? 0,
    };

    this.budgets.set(budget.id, budget);
    logger.info('Token budget created', { budgetId: budget.id, totalTokens: budget.totalTokens });
    return budget;
  }

  getBudget(budgetId: string): TokenBudget | undefined {
    return this.budgets.get(budgetId);
  }

  recordUsage(params: {
    budgetId: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    operationType: string;
    metadata?: Record<string, unknown>;
  }): TokenUsageRecord | null {
    const budget = this.budgets.get(params.budgetId);
    if (!budget) {
      logger.warn('Budget not found', { budgetId: params.budgetId });
      return null;
    }

    const totalTokens = params.promptTokens + params.completionTokens;
    const estimatedCost = this.calculateCost(params.model, params.promptTokens, params.completionTokens);

    if (budget.hardLimit && budget.usedTokens + totalTokens > budget.totalTokens) {
      logger.warn('Token budget exceeded', {
        budgetId: budget.id,
        used: budget.usedTokens,
        requested: totalTokens,
        limit: budget.totalTokens,
      });
      return null;
    }

    const record: TokenUsageRecord = {
      id: `usage_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
      budgetId: params.budgetId,
      model: params.model,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens,
      estimatedCost,
      operationType: params.operationType,
      metadata: params.metadata || {},
      timestamp: Date.now(),
    };

    budget.usedTokens += totalTokens;
    this.usageRecords.push(record);

    this.checkAlertThresholds(budget);

    return record;
  }

  reserveTokens(budgetId: string, tokens: number, durationMs: number = 300000): string | null {
    const budget = this.budgets.get(budgetId);
    if (!budget) return null;

    const available = budget.totalTokens - budget.usedTokens - budget.reservedTokens;
    if (tokens > available) return null;

    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    budget.reservedTokens += tokens;

    this.reservations.set(reservationId, {
      budgetId,
      tokens,
      expiresAt: Date.now() + durationMs,
    });

    return reservationId;
  }

  releaseReservation(reservationId: string): boolean {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return false;

    const budget = this.budgets.get(reservation.budgetId);
    if (budget) {
      budget.reservedTokens -= reservation.tokens;
    }

    this.reservations.delete(reservationId);
    return true;
  }

  calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing = this.pricing.get(model);
    if (!pricing) {
      const defaultCost = promptTokens * 0.000001 + completionTokens * 0.000002;
      return parseFloat(defaultCost.toFixed(6));
    }

    const cost =
      promptTokens * pricing.promptPricePerToken +
      completionTokens * pricing.completionPricePerToken;

    return parseFloat(cost.toFixed(6));
  }

  forecast(budgetId: string): BudgetForecast | null {
    const budget = this.budgets.get(budgetId);
    if (!budget) return null;

    const now = Date.now();
    const elapsedMs = now - budget.periodStart;
    const totalPeriodMs = budget.periodEnd - budget.periodStart;
    const daysElapsed = elapsedMs / (24 * 60 * 60 * 1000);
    const daysRemaining = Math.max(0, (budget.periodEnd - now) / (24 * 60 * 60 * 1000));

    const dailyBurnRate = daysElapsed > 0 ? budget.usedTokens / daysElapsed : 0;
    const projectedUsage = budget.usedTokens + dailyBurnRate * daysRemaining;

    const records = this.usageRecords.filter((r) => r.budgetId === budgetId);
    const totalCost = records.reduce((sum, r) => sum + r.estimatedCost, 0);
    const dailyCostRate = daysElapsed > 0 ? totalCost / daysElapsed : 0;
    const projectedCost = totalCost + dailyCostRate * daysRemaining;

    const willExceed = projectedUsage > budget.totalTokens;
    const remainingTokens = budget.totalTokens - budget.usedTokens;
    const estimatedExhaustionDate =
      dailyBurnRate > 0
        ? now + (remainingTokens / dailyBurnRate) * 24 * 60 * 60 * 1000
        : null;

    const recommendations: string[] = [];
    if (willExceed) {
      recommendations.push('Consider upgrading budget allocation');
      recommendations.push('Optimize prompt lengths to reduce token usage');
    }
    if (dailyBurnRate > (budget.totalTokens / (totalPeriodMs / (24 * 60 * 60 * 1000))) * 1.5) {
      recommendations.push('Usage rate significantly above average - review high-consumption operations');
    }
    if (records.length > 0) {
      const modelUsage = new Map<string, number>();
      for (const r of records) {
        modelUsage.set(r.model, (modelUsage.get(r.model) || 0) + r.totalTokens);
      }
      const [topModel] = [...modelUsage.entries()].sort((a, b) => b[1] - a[1]);
      if (topModel) {
        const cheaper = this.findCheaperAlternative(topModel[0]);
        if (cheaper) {
          recommendations.push(`Consider switching from ${topModel[0]} to ${cheaper} for cost savings`);
        }
      }
    }

    return {
      projectedUsage: Math.round(projectedUsage),
      projectedCost: parseFloat(projectedCost.toFixed(4)),
      daysRemaining: Math.round(daysRemaining),
      burnRate: Math.round(dailyBurnRate),
      willExceedBudget: willExceed,
      estimatedExhaustionDate: estimatedExhaustionDate ? Math.round(estimatedExhaustionDate) : null,
      recommendations,
    };
  }

  generateCostReport(budgetId: string): CostReport | null {
    const budget = this.budgets.get(budgetId);
    if (!budget) return null;

    const records = this.usageRecords.filter((r) => r.budgetId === budgetId);
    const byModel: Record<string, { tokens: number; cost: number }> = {};
    const byOperation: Record<string, { tokens: number; cost: number }> = {};
    const dailyMap = new Map<string, { tokens: number; cost: number }>();

    let totalTokens = 0;
    let totalCost = 0;

    for (const record of records) {
      totalTokens += record.totalTokens;
      totalCost += record.estimatedCost;

      if (!byModel[record.model]) {
        byModel[record.model] = { tokens: 0, cost: 0 };
      }
      byModel[record.model].tokens += record.totalTokens;
      byModel[record.model].cost += record.estimatedCost;

      if (!byOperation[record.operationType]) {
        byOperation[record.operationType] = { tokens: 0, cost: 0 };
      }
      byOperation[record.operationType].tokens += record.totalTokens;
      byOperation[record.operationType].cost += record.estimatedCost;

      const dateKey = new Date(record.timestamp).toISOString().split('T')[0];
      const existing = dailyMap.get(dateKey) || { tokens: 0, cost: 0 };
      existing.tokens += record.totalTokens;
      existing.cost += record.estimatedCost;
      dailyMap.set(dateKey, existing);
    }

    const dailyBreakdown = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        tokens: data.tokens,
        cost: parseFloat(data.cost.toFixed(4)),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const efficiency = budget.totalTokens > 0 ? totalTokens / budget.totalTokens : 0;

    return {
      periodStart: budget.periodStart,
      periodEnd: budget.periodEnd,
      totalTokens,
      totalCost: parseFloat(totalCost.toFixed(4)),
      byModel,
      byOperation,
      dailyBreakdown,
      efficiency: parseFloat(efficiency.toFixed(4)),
    };
  }

  optimizeModelSelection(
    operation: string,
    requiredCapabilities: string[],
    budgetId: string,
  ): string {
    const budget = this.budgets.get(budgetId);
    if (!budget) return 'gpt-3.5-turbo';

    const remainingTokens = budget.totalTokens - budget.usedTokens - budget.reservedTokens;
    const utilizationPercent = budget.usedTokens / budget.totalTokens;

    if (utilizationPercent > 0.9) {
      return 'gpt-3.5-turbo';
    }

    if (requiredCapabilities.includes('complex_reasoning') || requiredCapabilities.includes('code_generation')) {
      if (utilizationPercent < 0.5) {
        return 'gpt-4';
      }
      return 'gpt-4-turbo';
    }

    if (requiredCapabilities.includes('large_context')) {
      return 'claude-3-sonnet';
    }

    if (remainingTokens > budget.totalTokens * 0.3) {
      return 'gpt-4-turbo';
    }

    return 'gpt-3.5-turbo';
  }

  registerAlertCallback(
    budgetId: string,
    callback: (budget: TokenBudget, threshold: number) => void,
  ): void {
    const existing = this.alertCallbacks.get(budgetId) || [];
    existing.push(callback);
    this.alertCallbacks.set(budgetId, existing);
  }

  cleanExpiredReservations(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [reservationId, reservation] of this.reservations) {
      if (reservation.expiresAt <= now) {
        this.releaseReservation(reservationId);
        cleaned++;
      }
    }

    return cleaned;
  }

  getUsageRecords(budgetId: string, limit?: number): TokenUsageRecord[] {
    const records = this.usageRecords
      .filter((r) => r.budgetId === budgetId)
      .sort((a, b) => b.timestamp - a.timestamp);

    return limit ? records.slice(0, limit) : records;
  }

  getAllBudgets(tenantId?: string): TokenBudget[] {
    const budgets = Array.from(this.budgets.values());
    if (tenantId) {
      return budgets.filter((b) => b.tenantId === tenantId);
    }
    return budgets;
  }

  deleteBudget(budgetId: string): boolean {
    return this.budgets.delete(budgetId);
  }

  private checkAlertThresholds(budget: TokenBudget): void {
    const utilization = budget.usedTokens / budget.totalTokens;
    const callbacks = this.alertCallbacks.get(budget.id) || [];

    for (const threshold of budget.alertThresholds) {
      if (utilization >= threshold) {
        for (const cb of callbacks) {
          try {
            cb(budget, threshold);
          } catch (error) {
            logger.error('Alert callback failed', error as Error);
          }
        }
      }
    }
  }

  private findCheaperAlternative(currentModel: string): string | null {
    const currentPricing = this.pricing.get(currentModel);
    if (!currentPricing) return null;

    const currentCostPerToken = currentPricing.promptPricePerToken + currentPricing.completionPricePerToken;

    let cheapest: { model: string; cost: number } | null = null;
    for (const [model, pricing] of this.pricing) {
      if (model === currentModel) continue;
      const cost = pricing.promptPricePerToken + pricing.completionPricePerToken;
      if (cost < currentCostPerToken && (!cheapest || cost < cheapest.cost)) {
        cheapest = { model, cost };
      }
    }

    return cheapest?.model || null;
  }
}

let managerInstance: TokenBudgetManager | null = null;

export function getTokenBudgetManager(): TokenBudgetManager {
  if (!managerInstance) {
    managerInstance = new TokenBudgetManager();
  }
  return managerInstance;
}
