/**
 * Cost-Revenue Optimizer
 *
 * Token-cost attribution and margin optimization:
 * - Per-request AI token cost tracking
 * - Cost attribution by user/tenant/feature
 * - Revenue-to-cost margin analysis
 * - Budget guardrails with alerts
 * - Tier-based cost thresholds
 * - Token efficiency optimization suggestions
 * - Unprofitable usage detection
 * - Cost forecasting
 * - Model selection optimization (cost vs quality)
 * - Infrastructure cost allocation
 * - Real-time cost dashboard
 */

import { getLogger } from './logger';
import { getCache } from './cache';

const logger = getLogger();

export interface TokenCostEvent {
  id: string;
  userId: string;
  tenantId?: string;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface CostBudget {
  id: string;
  scope: 'user' | 'tenant' | 'global' | 'feature';
  scopeId: string;
  periodType: 'daily' | 'weekly' | 'monthly';
  limitUsd: number;
  alertThresholdPct: number; // e.g. 0.8 = alert at 80%
  hardStop: boolean; // block requests when exceeded
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetStatus {
  budget: CostBudget;
  spentUsd: number;
  remainingUsd: number;
  usedPct: number;
  periodStart: Date;
  periodEnd: Date;
  alertTriggered: boolean;
  hardStopTriggered: boolean;
  forecastEndOfPeriod?: number;
}

export interface CostSummary {
  scopeId: string;
  scopeType: string;
  period: string;
  totalCostUsd: number;
  totalRevenue: number;
  marginUsd: number;
  marginPct: number;
  tokenCount: number;
  requestCount: number;
  avgCostPerRequest: number;
  avgTokensPerRequest: number;
  topFeatures: Array<{ feature: string; costUsd: number; pct: number }>;
  topModels: Array<{ model: string; costUsd: number; tokens: number }>;
}

export interface ModelCostConfig {
  model: string;
  provider: string;
  costPerInputToken: number; // USD per token
  costPerOutputToken: number;
  qualityScore: number; // 0-100
  avgLatencyMs: number;
  maxContextTokens: number;
}

export interface OptimizationSuggestion {
  type: 'model_downgrade' | 'prompt_compression' | 'caching' | 'batch_requests' | 'tier_upgrade' | 'budget_alert';
  description: string;
  estimatedSavingUsd: number;
  estimatedSavingPct: number;
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  affectedFeatures: string[];
}

const MODEL_COSTS: ModelCostConfig[] = [
  { model: 'gpt-4o', provider: 'openai', costPerInputToken: 0.000005, costPerOutputToken: 0.000015, qualityScore: 95, avgLatencyMs: 2000, maxContextTokens: 128000 },
  { model: 'gpt-4o-mini', provider: 'openai', costPerInputToken: 0.00000015, costPerOutputToken: 0.0000006, qualityScore: 80, avgLatencyMs: 800, maxContextTokens: 128000 },
  { model: 'gpt-3.5-turbo', provider: 'openai', costPerInputToken: 0.0000005, costPerOutputToken: 0.0000015, qualityScore: 70, avgLatencyMs: 600, maxContextTokens: 16000 },
  { model: 'claude-3-haiku', provider: 'anthropic', costPerInputToken: 0.00000025, costPerOutputToken: 0.00000125, qualityScore: 78, avgLatencyMs: 700, maxContextTokens: 200000 },
  { model: 'claude-3-5-sonnet', provider: 'anthropic', costPerInputToken: 0.000003, costPerOutputToken: 0.000015, qualityScore: 90, avgLatencyMs: 1500, maxContextTokens: 200000 },
  { model: 'gemini-1.5-flash', provider: 'google', costPerInputToken: 0.000000075, costPerOutputToken: 0.0000003, qualityScore: 75, avgLatencyMs: 500, maxContextTokens: 1000000 },
];

const costEvents: TokenCostEvent[] = [];
const budgets = new Map<string, CostBudget>();
const MAX_EVENTS = 100000;

function generateEventId(): string {
  return `cost_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function calculateTokenCost(model: string, promptTokens: number, completionTokens: number): number {
  const config = MODEL_COSTS.find((m) => m.model === model);
  if (!config) return 0;
  return promptTokens * config.costPerInputToken + completionTokens * config.costPerOutputToken;
}

export function recordTokenUsage(params: {
  userId: string;
  tenantId?: string;
  feature: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}): TokenCostEvent {
  const costUsd = calculateTokenCost(params.model, params.promptTokens, params.completionTokens);

  const event: TokenCostEvent = {
    id: generateEventId(),
    ...params,
    totalTokens: params.promptTokens + params.completionTokens,
    costUsd,
    timestamp: new Date(),
  };

  costEvents.unshift(event);
  if (costEvents.length > MAX_EVENTS) costEvents.length = MAX_EVENTS;

  // Update rolling daily cost in cache
  const cache = getCache();
  const dayKey = `cost:daily:${params.userId}:${new Date().toISOString().slice(0, 10)}`;
  const dayTotal = (cache.get<number>(dayKey) ?? 0) + costUsd;
  cache.set(dayKey, dayTotal, 86400 * 2);

  const tenantDayKey = params.tenantId ? `cost:tenant:daily:${params.tenantId}:${new Date().toISOString().slice(0, 10)}` : null;
  if (tenantDayKey) {
    const tenantDayTotal = (cache.get<number>(tenantDayKey) ?? 0) + costUsd;
    cache.set(tenantDayKey, tenantDayTotal, 86400 * 2);
  }

  // Check budgets
  checkBudgetViolations(event);

  return event;
}

function checkBudgetViolations(event: TokenCostEvent): void {
  for (const budget of budgets.values()) {
    let relevant = false;
    switch (budget.scope) {
      case 'user': relevant = budget.scopeId === event.userId; break;
      case 'tenant': relevant = budget.scopeId === (event.tenantId ?? ''); break;
      case 'global': relevant = true; break;
      case 'feature': relevant = budget.scopeId === event.feature; break;
    }
    if (!relevant) continue;

    const status = getBudgetStatus(budget.id);
    if (!status) continue;

    if (status.usedPct >= 1.0 && budget.hardStop) {
      logger.error('Budget hard stop triggered', { budgetId: budget.id, scope: budget.scope, scopeId: budget.scopeId });
    } else if (status.usedPct >= budget.alertThresholdPct && !status.alertTriggered) {
      logger.warn('Budget alert threshold reached', {
        budgetId: budget.id,
        usedPct: (status.usedPct * 100).toFixed(1),
        spentUsd: status.spentUsd.toFixed(4),
        limitUsd: budget.limitUsd,
      });
    }
  }
}

function getPeriodStart(periodType: CostBudget['periodType']): Date {
  const now = new Date();
  switch (periodType) {
    case 'daily':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'weekly': {
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - dayOfWeek);
      monday.setHours(0, 0, 0, 0);
      return monday;
    }
    case 'monthly':
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

function getPeriodEnd(periodStart: Date, periodType: CostBudget['periodType']): Date {
  const end = new Date(periodStart);
  switch (periodType) {
    case 'daily': end.setDate(end.getDate() + 1); break;
    case 'weekly': end.setDate(end.getDate() + 7); break;
    case 'monthly': end.setMonth(end.getMonth() + 1); break;
  }
  return end;
}

export function createBudget(budget: Omit<CostBudget, 'createdAt' | 'updatedAt'>): CostBudget {
  const full: CostBudget = {
    ...budget,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  budgets.set(budget.id, full);
  logger.info('Cost budget created', { budgetId: budget.id, scope: budget.scope, limitUsd: budget.limitUsd });
  return full;
}

export function getBudgetStatus(budgetId: string): BudgetStatus | null {
  const budget = budgets.get(budgetId);
  if (!budget) return null;

  const periodStart = getPeriodStart(budget.periodType);
  const periodEnd = getPeriodEnd(periodStart, budget.periodType);

  let spentUsd = 0;
  const relevant = costEvents.filter((e) => {
    if (e.timestamp < periodStart) return false;
    switch (budget.scope) {
      case 'user': return e.userId === budget.scopeId;
      case 'tenant': return e.tenantId === budget.scopeId;
      case 'global': return true;
      case 'feature': return e.feature === budget.scopeId;
    }
  });
  spentUsd = relevant.reduce((s, e) => s + e.costUsd, 0);

  const remainingUsd = Math.max(0, budget.limitUsd - spentUsd);
  const usedPct = budget.limitUsd > 0 ? spentUsd / budget.limitUsd : 0;

  // Forecast
  const elapsed = Date.now() - periodStart.getTime();
  const total = periodEnd.getTime() - periodStart.getTime();
  const forecastEndOfPeriod = elapsed > 0 ? spentUsd * (total / elapsed) : undefined;

  return {
    budget,
    spentUsd,
    remainingUsd,
    usedPct,
    periodStart,
    periodEnd,
    alertTriggered: usedPct >= budget.alertThresholdPct,
    hardStopTriggered: usedPct >= 1.0 && budget.hardStop,
    forecastEndOfPeriod,
  };
}

export function isBudgetExceeded(scopeType: CostBudget['scope'], scopeId: string): boolean {
  for (const budget of budgets.values()) {
    if (budget.scope === scopeType && budget.scopeId === scopeId && budget.hardStop) {
      const status = getBudgetStatus(budget.id);
      if (status?.hardStopTriggered) return true;
    }
  }
  return false;
}

export function getCostSummary(
  scopeType: 'user' | 'tenant' | 'global',
  scopeId: string,
  periodDays = 30,
): CostSummary {
  const since = new Date(Date.now() - periodDays * 86400000);

  const events = costEvents.filter((e) => {
    if (e.timestamp < since) return false;
    switch (scopeType) {
      case 'user': return e.userId === scopeId;
      case 'tenant': return e.tenantId === scopeId;
      case 'global': return true;
    }
  });

  const totalCostUsd = events.reduce((s, e) => s + e.costUsd, 0);
  const tokenCount = events.reduce((s, e) => s + e.totalTokens, 0);

  const featureCosts = new Map<string, number>();
  const modelCosts = new Map<string, { costUsd: number; tokens: number }>();

  for (const e of events) {
    featureCosts.set(e.feature, (featureCosts.get(e.feature) ?? 0) + e.costUsd);
    const mc = modelCosts.get(e.model) ?? { costUsd: 0, tokens: 0 };
    mc.costUsd += e.costUsd;
    mc.tokens += e.totalTokens;
    modelCosts.set(e.model, mc);
  }

  const topFeatures = Array.from(featureCosts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([feature, costUsd]) => ({ feature, costUsd, pct: totalCostUsd > 0 ? costUsd / totalCostUsd : 0 }));

  const topModels = Array.from(modelCosts.entries())
    .sort((a, b) => b[1].costUsd - a[1].costUsd)
    .slice(0, 5)
    .map(([model, { costUsd, tokens }]) => ({ model, costUsd, tokens }));

  // Estimate revenue (simplified: assume tier-based ARR / period)
  const estimatedRevenue = scopeType === 'user' ? 29.0 : scopeType === 'tenant' ? 299.0 : 50000;
  const adjustedRevenue = (estimatedRevenue / 365) * periodDays;
  const marginUsd = adjustedRevenue - totalCostUsd;
  const marginPct = adjustedRevenue > 0 ? marginUsd / adjustedRevenue : 0;

  return {
    scopeId,
    scopeType,
    period: `last_${periodDays}_days`,
    totalCostUsd,
    totalRevenue: adjustedRevenue,
    marginUsd,
    marginPct,
    tokenCount,
    requestCount: events.length,
    avgCostPerRequest: events.length > 0 ? totalCostUsd / events.length : 0,
    avgTokensPerRequest: events.length > 0 ? tokenCount / events.length : 0,
    topFeatures,
    topModels,
  };
}

export function getOptimizationSuggestions(userId: string): OptimizationSuggestion[] {
  const summary = getCostSummary('user', userId, 30);
  const suggestions: OptimizationSuggestion[] = [];

  // Model downgrade suggestion
  const gpt4Events = costEvents.filter((e) => e.userId === userId && e.model.startsWith('gpt-4o'));
  if (gpt4Events.length > 50) {
    const gpt4Cost = gpt4Events.reduce((s, e) => s + e.costUsd, 0);
    const miniModel = MODEL_COSTS.find((m) => m.model === 'gpt-4o-mini')!;
    const currentModel = MODEL_COSTS.find((m) => m.model === 'gpt-4o')!;
    const avgTokens = gpt4Events.reduce((s, e) => s + e.totalTokens, 0) / gpt4Events.length;
    const miniCost = gpt4Events.length * avgTokens * 0.5 * miniModel.costPerInputToken;
    const saving = gpt4Cost - miniCost;

    if (saving > 1) {
      suggestions.push({
        type: 'model_downgrade',
        description: `Switch from gpt-4o to gpt-4o-mini for routine content generation. Quality drop: ${currentModel.qualityScore - miniModel.qualityScore} points.`,
        estimatedSavingUsd: saving,
        estimatedSavingPct: gpt4Cost > 0 ? saving / gpt4Cost : 0,
        impact: 'low',
        effort: 'low',
        affectedFeatures: Array.from(new Set(gpt4Events.map((e) => e.feature))),
      });
    }
  }

  // Caching suggestion
  const cacheableFeatures = summary.topFeatures.filter((f) => f.pct > 0.2);
  if (cacheableFeatures.length > 0) {
    const savingEst = cacheableFeatures.reduce((s, f) => s + f.costUsd * 0.4, 0);
    suggestions.push({
      type: 'caching',
      description: `Enable response caching for top features (${cacheableFeatures.map((f) => f.feature).join(', ')}). Estimated 40% hit rate.`,
      estimatedSavingUsd: savingEst,
      estimatedSavingPct: summary.totalCostUsd > 0 ? savingEst / summary.totalCostUsd : 0,
      impact: 'medium',
      effort: 'low',
      affectedFeatures: cacheableFeatures.map((f) => f.feature),
    });
  }

  // Prompt compression
  if (summary.avgTokensPerRequest > 2000) {
    const compressedSaving = summary.totalCostUsd * 0.25;
    suggestions.push({
      type: 'prompt_compression',
      description: `Average prompt size is ${Math.round(summary.avgTokensPerRequest)} tokens. Compressing prompts by ~25% could reduce costs significantly.`,
      estimatedSavingUsd: compressedSaving,
      estimatedSavingPct: 0.25,
      impact: 'medium',
      effort: 'medium',
      affectedFeatures: summary.topFeatures.map((f) => f.feature),
    });
  }

  return suggestions.sort((a, b) => b.estimatedSavingUsd - a.estimatedSavingUsd);
}

export function selectOptimalModel(requirements: {
  maxLatencyMs?: number;
  minQuality?: number;
  maxCostPer1kTokens?: number;
  contextTokens?: number;
}): ModelCostConfig | null {
  let candidates = [...MODEL_COSTS];

  if (requirements.maxLatencyMs) candidates = candidates.filter((m) => m.avgLatencyMs <= requirements.maxLatencyMs!);
  if (requirements.minQuality) candidates = candidates.filter((m) => m.qualityScore >= requirements.minQuality!);
  if (requirements.contextTokens) candidates = candidates.filter((m) => m.maxContextTokens >= requirements.contextTokens!);
  if (requirements.maxCostPer1kTokens) {
    candidates = candidates.filter((m) =>
      (m.costPerInputToken + m.costPerOutputToken) * 1000 <= requirements.maxCostPer1kTokens!,
    );
  }

  if (candidates.length === 0) return null;

  // Sort by cost ASC, then quality DESC
  candidates.sort((a, b) => {
    const costDiff = (a.costPerInputToken + a.costPerOutputToken) - (b.costPerInputToken + b.costPerOutputToken);
    if (Math.abs(costDiff) > 0.000001) return costDiff;
    return b.qualityScore - a.qualityScore;
  });

  return candidates[0];
}

export function getModelCosts(): ModelCostConfig[] {
  return [...MODEL_COSTS];
}

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  return calculateTokenCost(model, promptTokens, completionTokens);
}

export function getCostEvents(options: {
  userId?: string;
  tenantId?: string;
  feature?: string;
  fromDate?: Date;
  limit?: number;
} = {}): TokenCostEvent[] {
  let events = [...costEvents];
  if (options.userId) events = events.filter((e) => e.userId === options.userId);
  if (options.tenantId) events = events.filter((e) => e.tenantId === options.tenantId);
  if (options.feature) events = events.filter((e) => e.feature === options.feature);
  if (options.fromDate) events = events.filter((e) => e.timestamp >= options.fromDate!);
  return events.slice(0, options.limit ?? 100);
}

export function getPlatformCostDashboard(): {
  totalCostUsd: number;
  totalRevenue: number;
  margin: number;
  tokensBilledToday: number;
  topCostUsers: Array<{ userId: string; costUsd: number }>;
  costByModel: Record<string, number>;
  hourlyTrend: Array<{ hour: string; costUsd: number }>;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEvents = costEvents.filter((e) => e.timestamp >= today);

  const totalCost = todayEvents.reduce((s, e) => s + e.costUsd, 0);
  const tokensBilled = todayEvents.reduce((s, e) => s + e.totalTokens, 0);

  const userCosts = new Map<string, number>();
  const modelCosts: Record<string, number> = {};
  const hourlyCosts = new Map<string, number>();

  for (const e of todayEvents) {
    userCosts.set(e.userId, (userCosts.get(e.userId) ?? 0) + e.costUsd);
    modelCosts[e.model] = (modelCosts[e.model] ?? 0) + e.costUsd;
    const hour = e.timestamp.toISOString().slice(0, 13);
    hourlyCosts.set(hour, (hourlyCosts.get(hour) ?? 0) + e.costUsd);
  }

  return {
    totalCostUsd: totalCost,
    totalRevenue: totalCost * 10, // simplified: 10x cost = revenue assumption
    margin: totalCost * 9,
    tokensBilledToday: tokensBilled,
    topCostUsers: Array.from(userCosts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, costUsd]) => ({ userId, costUsd })),
    costByModel: modelCosts,
    hourlyTrend: Array.from(hourlyCosts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([hour, costUsd]) => ({ hour, costUsd })),
  };
}
