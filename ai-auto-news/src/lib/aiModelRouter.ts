/**
 * Intelligent AI Model Router
 *
 * Cross-provider AI model routing with:
 * - Model selection based on task type and requirements
 * - Cost tracking and budget management per model
 * - Latency monitoring and SLA enforcement
 * - Automatic failover and circuit breaking
 * - A/B testing of models
 * - Rate limit awareness and backoff
 * - Token budget management
 * - Load balancing across providers
 */

import { getLogger } from './logger';
import { getCache } from './cache';
import crypto from 'crypto';

const logger = getLogger();

// ── Types ────────────────────────────────────────────────────────────────────

export type AIProvider = 'openai' | 'anthropic' | 'gemini' | 'local' | 'perplexity';

export type TaskType =
  | 'text-generation'
  | 'summarization'
  | 'classification'
  | 'embedding'
  | 'code-generation'
  | 'analysis'
  | 'translation'
  | 'moderation'
  | 'extraction'
  | 'question-answering';

export type ModelTier = 'fast' | 'balanced' | 'powerful' | 'specialized';

export interface ModelConfig {
  id: string;
  provider: AIProvider;
  modelName: string;
  tier: ModelTier;
  capabilities: TaskType[];
  maxTokens: number;
  contextWindow: number;
  costPerInputToken: number;   // USD per token
  costPerOutputToken: number;
  avgLatencyMs: number;
  rateLimit: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
  isAvailable: boolean;
  priority: number; // lower = higher priority
}

export interface RoutingRequest {
  taskType: TaskType;
  inputTokens?: number;
  maxOutputTokens?: number;
  urgency?: 'low' | 'normal' | 'high';
  qualityRequirement?: 'draft' | 'standard' | 'premium';
  budgetCents?: number; // max spend in cents
  preferredProvider?: AIProvider;
  experimentGroup?: string;
}

export interface RoutingDecision {
  requestId: string;
  selectedModel: ModelConfig;
  reason: string;
  alternativeModels: ModelConfig[];
  estimatedCostCents: number;
  estimatedLatencyMs: number;
  timestamp: Date;
  abTestGroup?: string;
}

export interface ModelMetrics {
  modelId: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostCents: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorRate: number;
  rateLimitHits: number;
  lastUsed: Date;
  latencyHistory: number[];
}

export interface RateLimitState {
  modelId: string;
  requestsThisMinute: number;
  tokensThisMinute: number;
  windowStart: number;
  isThrottled: boolean;
  throttledUntil?: number;
}

export interface ABTest {
  id: string;
  name: string;
  taskType: TaskType;
  modelA: string;
  modelB: string;
  trafficSplit: number; // 0–1, fraction to model B
  active: boolean;
  startedAt: Date;
  metrics: {
    modelA: { requests: number; avgLatency: number; successRate: number; avgCost: number };
    modelB: { requests: number; avgLatency: number; successRate: number; avgCost: number };
  };
}

export interface TokenBudget {
  userId: string;
  dailyLimitTokens: number;
  monthlyLimitTokens: number;
  dailyUsed: number;
  monthlyUsed: number;
  resetDailyAt: Date;
  resetMonthlyAt: Date;
}

export interface ModelRouterStats {
  totalRequests: number;
  totalCostCents: number;
  requestsByProvider: Record<AIProvider, number>;
  requestsByModel: Record<string, number>;
  failoverCount: number;
  abTestsActive: number;
  modelsAvailable: number;
  avgRoutingLatencyMs: number;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'openai-gpt4o',
    provider: 'openai',
    modelName: 'gpt-4o',
    tier: 'powerful',
    capabilities: ['text-generation', 'summarization', 'classification', 'code-generation', 'analysis', 'extraction', 'question-answering'],
    maxTokens: 4096,
    contextWindow: 128000,
    costPerInputToken: 0.000005,
    costPerOutputToken: 0.000015,
    avgLatencyMs: 1800,
    rateLimit: { requestsPerMinute: 500, tokensPerMinute: 150000 },
    isAvailable: true,
    priority: 2,
  },
  {
    id: 'openai-gpt4o-mini',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    tier: 'fast',
    capabilities: ['text-generation', 'summarization', 'classification', 'extraction', 'moderation'],
    maxTokens: 16384,
    contextWindow: 128000,
    costPerInputToken: 0.00000015,
    costPerOutputToken: 0.0000006,
    avgLatencyMs: 600,
    rateLimit: { requestsPerMinute: 2000, tokensPerMinute: 800000 },
    isAvailable: true,
    priority: 1,
  },
  {
    id: 'anthropic-claude3-opus',
    provider: 'anthropic',
    modelName: 'claude-3-opus-20240229',
    tier: 'powerful',
    capabilities: ['text-generation', 'summarization', 'analysis', 'code-generation', 'question-answering', 'extraction'],
    maxTokens: 4096,
    contextWindow: 200000,
    costPerInputToken: 0.000015,
    costPerOutputToken: 0.000075,
    avgLatencyMs: 2200,
    rateLimit: { requestsPerMinute: 200, tokensPerMinute: 50000 },
    isAvailable: true,
    priority: 3,
  },
  {
    id: 'anthropic-claude3-haiku',
    provider: 'anthropic',
    modelName: 'claude-3-haiku-20240307',
    tier: 'fast',
    capabilities: ['text-generation', 'summarization', 'classification', 'moderation', 'translation'],
    maxTokens: 4096,
    contextWindow: 200000,
    costPerInputToken: 0.00000025,
    costPerOutputToken: 0.00000125,
    avgLatencyMs: 400,
    rateLimit: { requestsPerMinute: 2000, tokensPerMinute: 250000 },
    isAvailable: true,
    priority: 1,
  },
  {
    id: 'gemini-pro',
    provider: 'gemini',
    modelName: 'gemini-1.5-pro',
    tier: 'balanced',
    capabilities: ['text-generation', 'summarization', 'analysis', 'extraction', 'translation'],
    maxTokens: 8192,
    contextWindow: 1000000,
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000012,
    avgLatencyMs: 1200,
    rateLimit: { requestsPerMinute: 300, tokensPerMinute: 120000 },
    isAvailable: true,
    priority: 2,
  },
  {
    id: 'gemini-flash',
    provider: 'gemini',
    modelName: 'gemini-1.5-flash',
    tier: 'fast',
    capabilities: ['text-generation', 'summarization', 'classification', 'moderation'],
    maxTokens: 8192,
    contextWindow: 1000000,
    costPerInputToken: 0.00000035,
    costPerOutputToken: 0.00000105,
    avgLatencyMs: 350,
    rateLimit: { requestsPerMinute: 1000, tokensPerMinute: 500000 },
    isAvailable: true,
    priority: 1,
  },
];

// ── AIModelRouter class ───────────────────────────────────────────────────────

class AIModelRouter {
  private models: Map<string, ModelConfig> = new Map();
  private metrics: Map<string, ModelMetrics> = new Map();
  private rateLimitStates: Map<string, RateLimitState> = new Map();
  private abTests: Map<string, ABTest> = new Map();
  private tokenBudgets: Map<string, TokenBudget> = new Map();
  private totalRequests = 0;
  private totalCostCents = 0;
  private failoverCount = 0;
  private routingLatencies: number[] = [];

  constructor() {
    for (const model of DEFAULT_MODELS) {
      this.registerModel(model);
    }
    // Rate limit window reset every minute
    setInterval(() => this.resetRateLimitWindows(), 60_000);
  }

  // ── Model Registration ──────────────────────────────────────────────────────

  registerModel(config: ModelConfig): void {
    this.models.set(config.id, config);
    if (!this.metrics.has(config.id)) {
      this.metrics.set(config.id, {
        modelId: config.id,
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCostCents: 0,
        avgLatencyMs: config.avgLatencyMs,
        p95LatencyMs: config.avgLatencyMs * 1.5,
        errorRate: 0,
        rateLimitHits: 0,
        lastUsed: new Date(0),
        latencyHistory: [],
      });
    }
    this.rateLimitStates.set(config.id, {
      modelId: config.id,
      requestsThisMinute: 0,
      tokensThisMinute: 0,
      windowStart: Date.now(),
      isThrottled: false,
    });
    logger.info('Model registered', { modelId: config.id, provider: config.provider });
  }

  setModelAvailability(modelId: string, available: boolean): void {
    const model = this.models.get(modelId);
    if (model) {
      model.isAvailable = available;
      logger.info('Model availability updated', { modelId, available });
    }
  }

  // ── Routing ─────────────────────────────────────────────────────────────────

  route(request: RoutingRequest): RoutingDecision {
    const start = Date.now();
    const requestId = crypto.randomUUID();

    // Check A/B test override
    const abTestResult = this.checkABTest(request.taskType, request.experimentGroup);

    // Gather candidates
    const candidates = this.getCandidateModels(request);

    if (candidates.length === 0) {
      throw new Error(`No available models for task: ${request.taskType}`);
    }

    // Score and rank candidates
    const scored = candidates.map((m) => ({
      model: m,
      score: this.scoreModel(m, request),
    }));
    scored.sort((a, b) => b.score - a.score);

    let selected = scored[0].model;

    // Apply A/B test override if active
    if (abTestResult) {
      const override = this.models.get(abTestResult.modelId);
      if (override && !this.isRateLimited(override.id)) {
        selected = override;
      }
    }

    const estimatedCost = this.estimateCost(selected, request.inputTokens ?? 500, request.maxOutputTokens ?? 500);
    const alternatives = scored.slice(1, 4).map((s) => s.model);

    const routingMs = Date.now() - start;
    this.routingLatencies.push(routingMs);
    if (this.routingLatencies.length > 1000) this.routingLatencies.shift();

    this.totalRequests++;

    const decision: RoutingDecision = {
      requestId,
      selectedModel: selected,
      reason: this.buildReason(selected, request, abTestResult?.testId),
      alternativeModels: alternatives,
      estimatedCostCents: Math.round(estimatedCost * 100),
      estimatedLatencyMs: this.getExpectedLatency(selected.id),
      timestamp: new Date(),
      abTestGroup: abTestResult?.group,
    };

    logger.debug('Routing decision made', {
      requestId,
      selectedModel: selected.id,
      taskType: request.taskType,
      estimatedCostCents: decision.estimatedCostCents,
    });

    return decision;
  }

  private getCandidateModels(request: RoutingRequest): ModelConfig[] {
    return Array.from(this.models.values()).filter((m) => {
      if (!m.isAvailable) return false;
      if (!m.capabilities.includes(request.taskType)) return false;
      if (this.isRateLimited(m.id)) return false;

      // Budget check
      if (request.budgetCents !== undefined) {
        const cost = this.estimateCost(m, request.inputTokens ?? 500, request.maxOutputTokens ?? 500);
        if (cost * 100 > request.budgetCents) return false;
      }

      // Provider preference
      if (request.preferredProvider && m.provider !== request.preferredProvider) {
        // Still include but it will score lower
      }

      return true;
    });
  }

  private scoreModel(model: ModelConfig, request: RoutingRequest): number {
    let score = 100;
    const metrics = this.metrics.get(model.id);

    // Prefer lower priority number (= higher importance)
    score -= model.priority * 5;

    // Quality requirement
    const qualityMap: Record<string, string[]> = {
      draft: ['fast'],
      standard: ['fast', 'balanced'],
      premium: ['balanced', 'powerful'],
    };
    const preferred = qualityMap[request.qualityRequirement ?? 'standard'] ?? ['fast', 'balanced'];
    if (preferred.includes(model.tier)) score += 20;

    // Urgency: penalize slow models when high urgency
    if (request.urgency === 'high') {
      const latency = this.getExpectedLatency(model.id);
      score -= Math.floor(latency / 200);
    }

    // Provider preference bonus
    if (request.preferredProvider && model.provider === request.preferredProvider) {
      score += 15;
    }

    // Cost optimization: bonus for cheaper models
    const cost = this.estimateCost(model, request.inputTokens ?? 500, request.maxOutputTokens ?? 500);
    score -= Math.floor(cost * 1000);

    // Penalize high error rate
    if (metrics) {
      score -= Math.floor(metrics.errorRate * 50);
    }

    return score;
  }

  private buildReason(model: ModelConfig, request: RoutingRequest, abTestId?: string): string {
    const parts: string[] = [`Selected ${model.modelName} (${model.provider})`];
    if (abTestId) parts.push(`via A/B test ${abTestId}`);
    parts.push(`for ${request.taskType} [${model.tier} tier]`);
    if (request.urgency === 'high') parts.push('with urgency routing');
    return parts.join(' ');
  }

  // ── Result Recording ────────────────────────────────────────────────────────

  recordResult(
    modelId: string,
    success: boolean,
    latencyMs: number,
    tokensIn: number,
    tokensOut: number,
  ): void {
    const metrics = this.metrics.get(modelId);
    if (!metrics) return;

    metrics.requestCount++;
    if (success) {
      metrics.successCount++;
    } else {
      metrics.failureCount++;
    }

    metrics.totalTokensIn += tokensIn;
    metrics.totalTokensOut += tokensOut;
    metrics.lastUsed = new Date();

    // Update latency (rolling average)
    metrics.latencyHistory.push(latencyMs);
    if (metrics.latencyHistory.length > 100) metrics.latencyHistory.shift();
    metrics.avgLatencyMs = metrics.latencyHistory.reduce((a, b) => a + b, 0) / metrics.latencyHistory.length;

    // p95
    const sorted = [...metrics.latencyHistory].sort((a, b) => a - b);
    metrics.p95LatencyMs = sorted[Math.floor(sorted.length * 0.95)] ?? metrics.avgLatencyMs;

    // Error rate
    metrics.errorRate = metrics.requestCount > 0 ? metrics.failureCount / metrics.requestCount : 0;

    // Cost
    const model = this.models.get(modelId);
    if (model) {
      const costCents = (tokensIn * model.costPerInputToken + tokensOut * model.costPerOutputToken) * 100;
      metrics.totalCostCents += costCents;
      this.totalCostCents += costCents;
    }

    // Rate limit state update
    const rl = this.rateLimitStates.get(modelId);
    if (rl) {
      rl.requestsThisMinute++;
      rl.tokensThisMinute += tokensIn + tokensOut;
    }

    // Update A/B test metrics
    this.updateABTestMetrics(modelId, success, latencyMs);
  }

  recordFailover(fromModelId: string, toModelId: string): void {
    this.failoverCount++;
    logger.warn('Model failover', { from: fromModelId, to: toModelId });
  }

  // ── Rate Limiting ───────────────────────────────────────────────────────────

  private isRateLimited(modelId: string): boolean {
    const state = this.rateLimitStates.get(modelId);
    const model = this.models.get(modelId);
    if (!state || !model) return false;

    if (state.isThrottled && state.throttledUntil && Date.now() < state.throttledUntil) {
      return true;
    }

    if (state.requestsThisMinute >= model.rateLimit.requestsPerMinute) {
      state.isThrottled = true;
      state.throttledUntil = state.windowStart + 60_000;
      const m = this.metrics.get(modelId);
      if (m) m.rateLimitHits++;
      return true;
    }

    if (state.tokensThisMinute >= model.rateLimit.tokensPerMinute) {
      state.isThrottled = true;
      state.throttledUntil = state.windowStart + 60_000;
      return true;
    }

    state.isThrottled = false;
    return false;
  }

  private resetRateLimitWindows(): void {
    const now = Date.now();
    for (const [, state] of this.rateLimitStates) {
      if (now - state.windowStart >= 60_000) {
        state.requestsThisMinute = 0;
        state.tokensThisMinute = 0;
        state.windowStart = now;
        state.isThrottled = false;
      }
    }
  }

  // ── A/B Testing ─────────────────────────────────────────────────────────────

  createABTest(config: Omit<ABTest, 'metrics' | 'startedAt'>): void {
    const test: ABTest = {
      ...config,
      startedAt: new Date(),
      metrics: {
        modelA: { requests: 0, avgLatency: 0, successRate: 1, avgCost: 0 },
        modelB: { requests: 0, avgLatency: 0, successRate: 1, avgCost: 0 },
      },
    };
    this.abTests.set(config.id, test);
    logger.info('A/B test created', { testId: config.id, modelA: config.modelA, modelB: config.modelB });
  }

  private checkABTest(taskType: TaskType, experimentGroup?: string): { modelId: string; testId: string; group: string } | null {
    for (const [, test] of this.abTests) {
      if (!test.active || test.taskType !== taskType) continue;

      const hash = experimentGroup
        ? parseInt(crypto.createHash('md5').update(experimentGroup).digest('hex').slice(0, 8), 16)
        : Math.random() * 0xffffffff;

      const fraction = (hash % 10000) / 10000;
      if (fraction < test.trafficSplit) {
        return { modelId: test.modelB, testId: test.id, group: 'B' };
      } else {
        return { modelId: test.modelA, testId: test.id, group: 'A' };
      }
    }
    return null;
  }

  private updateABTestMetrics(modelId: string, success: boolean, latencyMs: number): void {
    for (const [, test] of this.abTests) {
      if (!test.active) continue;
      const isA = test.modelA === modelId;
      const isB = test.modelB === modelId;
      if (!isA && !isB) continue;

      const side = isA ? test.metrics.modelA : test.metrics.modelB;
      const total = side.requests + 1;
      side.avgLatency = (side.avgLatency * side.requests + latencyMs) / total;
      side.successRate = (side.successRate * side.requests + (success ? 1 : 0)) / total;
      side.requests = total;
    }
  }

  stopABTest(testId: string): ABTest | null {
    const test = this.abTests.get(testId);
    if (test) {
      test.active = false;
      logger.info('A/B test stopped', { testId });
    }
    return test ?? null;
  }

  // ── Token Budget ─────────────────────────────────────────────────────────────

  setTokenBudget(userId: string, dailyLimit: number, monthlyLimit: number): void {
    const now = new Date();
    const daily = new Date(now);
    daily.setDate(daily.getDate() + 1);
    daily.setHours(0, 0, 0, 0);
    const monthly = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    this.tokenBudgets.set(userId, {
      userId,
      dailyLimitTokens: dailyLimit,
      monthlyLimitTokens: monthlyLimit,
      dailyUsed: 0,
      monthlyUsed: 0,
      resetDailyAt: daily,
      resetMonthlyAt: monthly,
    });
  }

  checkTokenBudget(userId: string, tokens: number): { allowed: boolean; reason?: string } {
    const budget = this.tokenBudgets.get(userId);
    if (!budget) return { allowed: true };

    const now = new Date();
    if (now >= budget.resetDailyAt) {
      budget.dailyUsed = 0;
      budget.resetDailyAt = new Date(now.getTime() + 86_400_000);
    }
    if (now >= budget.resetMonthlyAt) {
      budget.monthlyUsed = 0;
      budget.resetMonthlyAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    if (budget.dailyUsed + tokens > budget.dailyLimitTokens) {
      return { allowed: false, reason: 'Daily token limit exceeded' };
    }
    if (budget.monthlyUsed + tokens > budget.monthlyLimitTokens) {
      return { allowed: false, reason: 'Monthly token limit exceeded' };
    }
    return { allowed: true };
  }

  consumeTokenBudget(userId: string, tokens: number): void {
    const budget = this.tokenBudgets.get(userId);
    if (!budget) return;
    budget.dailyUsed += tokens;
    budget.monthlyUsed += tokens;
  }

  // ── Cost Estimation ─────────────────────────────────────────────────────────

  private estimateCost(model: ModelConfig, tokensIn: number, tokensOut: number): number {
    return tokensIn * model.costPerInputToken + tokensOut * model.costPerOutputToken;
  }

  estimateCostForRequest(modelId: string, tokensIn: number, tokensOut: number): number {
    const model = this.models.get(modelId);
    if (!model) return 0;
    return this.estimateCost(model, tokensIn, tokensOut);
  }

  // ── Latency Tracking ────────────────────────────────────────────────────────

  private getExpectedLatency(modelId: string): number {
    const metrics = this.metrics.get(modelId);
    if (metrics && metrics.requestCount > 5) {
      return metrics.avgLatencyMs;
    }
    return this.models.get(modelId)?.avgLatencyMs ?? 1000;
  }

  // ── Statistics ──────────────────────────────────────────────────────────────

  getModelMetrics(modelId: string): ModelMetrics | null {
    return this.metrics.get(modelId) ?? null;
  }

  getAllModelMetrics(): ModelMetrics[] {
    return Array.from(this.metrics.values());
  }

  getStats(): ModelRouterStats {
    const requestsByProvider: Record<AIProvider, number> = {
      openai: 0, anthropic: 0, gemini: 0, local: 0, perplexity: 0,
    };
    const requestsByModel: Record<string, number> = {};

    for (const [id, m] of this.metrics) {
      requestsByModel[id] = m.requestCount;
      const model = this.models.get(id);
      if (model) requestsByProvider[model.provider] += m.requestCount;
    }

    const avgRoutingMs = this.routingLatencies.length > 0
      ? this.routingLatencies.reduce((a, b) => a + b, 0) / this.routingLatencies.length
      : 0;

    return {
      totalRequests: this.totalRequests,
      totalCostCents: Math.round(this.totalCostCents),
      requestsByProvider,
      requestsByModel,
      failoverCount: this.failoverCount,
      abTestsActive: Array.from(this.abTests.values()).filter((t) => t.active).length,
      modelsAvailable: Array.from(this.models.values()).filter((m) => m.isAvailable).length,
      avgRoutingLatencyMs: Math.round(avgRoutingMs),
    };
  }

  getAvailableModels(): ModelConfig[] {
    return Array.from(this.models.values()).filter((m) => m.isAvailable);
  }

  getModelById(modelId: string): ModelConfig | null {
    return this.models.get(modelId) ?? null;
  }

  getABTests(): ABTest[] {
    return Array.from(this.abTests.values());
  }

  getCostReport(since?: Date): { modelId: string; costCents: number; requests: number }[] {
    return Array.from(this.metrics.values()).map((m) => ({
      modelId: m.modelId,
      costCents: Math.round(m.totalCostCents),
      requests: m.requestCount,
    }));
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__aiModelRouter__';

export function getAIModelRouter(): AIModelRouter {
  const g = globalThis as unknown as Record<string, AIModelRouter>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new AIModelRouter();
  }
  return g[GLOBAL_KEY];
}

export { AIModelRouter };
export default getAIModelRouter;
