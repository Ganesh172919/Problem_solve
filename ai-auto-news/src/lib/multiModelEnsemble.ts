/**
 * @module multiModelEnsemble
 * @description Multi-model AI ensemble orchestration for improved inference quality
 * and cost efficiency. Supports majority vote, weighted average, best-of-n, cascade,
 * routing, and mixture-of-experts strategies with cost-aware model selection and
 * latency SLA enforcement.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'gemini' | 'local';
  model: string;
  maxTokens: number;
  costPerToken: number;
  avgLatencyMs: number;
  qualityScore: number;
  specializations: string[];
}

export type EnsembleStrategy =
  | 'majority_vote'
  | 'weighted_average'
  | 'best_of_n'
  | 'cascade'
  | 'routing'
  | 'mixture_of_experts';

export interface InferenceRequest {
  id: string;
  prompt: string;
  taskType: string;
  requiredQuality: number;
  maxCostTokens: number;
  maxLatencyMs: number;
  contextWindow: number;
}

export interface ModelResponse {
  modelId: string;
  content: string;
  confidence: number;
  latencyMs: number;
  tokensUsed: number;
  cost: number;
  metadata: Record<string, unknown>;
}

export interface EnsembleResult {
  requestId: string;
  finalResponse: string;
  modelResponses: ModelResponse[];
  strategy: EnsembleStrategy;
  consensusScore: number;
  totalCost: number;
  totalLatencyMs: number;
}

export interface RoutingDecision {
  requestId: string;
  selectedModels: string[];
  strategy: EnsembleStrategy;
  reasoning: string;
  estimatedCost: number;
}

export interface EnsembleMetrics {
  totalRequests: number;
  avgConsensusScore: number;
  avgCost: number;
  avgLatency: number;
  modelUsageDistribution: Record<string, number>;
  costSavings: number;
}

export interface QualityEvaluator {
  criteria: string[];
  weights: number[];
}

// ── Internal types ────────────────────────────────────────────────────────────

interface ModelStats {
  totalCalls: number;
  totalLatencyMs: number;
  totalCost: number;
  totalTokens: number;
  avgConfidence: number;
  successRate: number;
}

// ── Class ─────────────────────────────────────────────────────────────────────

export class MultiModelEnsemble {
  private models: Map<string, ModelConfig> = new Map();
  private modelStats: Map<string, ModelStats> = new Map();
  private metrics: EnsembleMetrics = {
    totalRequests: 0,
    avgConsensusScore: 0,
    avgCost: 0,
    avgLatency: 0,
    modelUsageDistribution: {},
    costSavings: 0,
  };
  private consensusHistory: number[] = [];
  private costHistory: number[] = [];
  private latencyHistory: number[] = [];
  private qualityEvaluator: QualityEvaluator = {
    criteria: ['coherence', 'relevance', 'completeness', 'accuracy'],
    weights: [0.3, 0.3, 0.2, 0.2],
  };

  registerModel(config: ModelConfig): void {
    this.models.set(config.id, config);
    this.modelStats.set(config.id, {
      totalCalls: 0,
      totalLatencyMs: 0,
      totalCost: 0,
      totalTokens: 0,
      avgConfidence: config.qualityScore,
      successRate: 1.0,
    });
    this.metrics.modelUsageDistribution[config.id] = 0;
    logger.info('Model registered', { modelId: config.id, provider: config.provider });
  }

  route(request: InferenceRequest): RoutingDecision {
    const eligible = Array.from(this.models.values()).filter(
      (m) =>
        m.avgLatencyMs <= request.maxLatencyMs &&
        m.costPerToken * request.contextWindow <= request.maxCostTokens,
    );

    if (eligible.length === 0) {
      // Relax latency by 20% and retry
      const relaxed = Array.from(this.models.values()).filter(
        (m) => m.costPerToken * request.contextWindow <= request.maxCostTokens * 1.2,
      );
      return this.buildRoutingDecision(request, relaxed.length > 0 ? relaxed : Array.from(this.models.values()));
    }

    // Specialization routing
    const specialized = eligible.filter((m) =>
      m.specializations.some((s) => s.toLowerCase().includes(request.taskType.toLowerCase())),
    );

    let selected: ModelConfig[];
    let strategy: EnsembleStrategy;
    let reasoning: string;

    if (specialized.length >= 2) {
      selected = specialized.slice(0, 3);
      strategy = 'mixture_of_experts';
      reasoning = `Routing to ${selected.length} specialized models for task type: ${request.taskType}`;
    } else if (request.requiredQuality >= 0.9) {
      selected = eligible.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 3);
      strategy = 'majority_vote';
      reasoning = 'High quality requirement: using top-3 models with majority vote';
    } else if (request.maxLatencyMs <= 500) {
      selected = [eligible.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0]];
      strategy = 'routing';
      reasoning = 'Low latency SLA: single fastest model selected';
    } else {
      selected = eligible.sort((a, b) => a.costPerToken - b.costPerToken).slice(0, 2);
      strategy = 'cascade';
      reasoning = 'Cost-optimized cascade: cheap model first with quality fallback';
    }

    return this.buildRoutingDecision(request, selected, strategy, reasoning);
  }

  private buildRoutingDecision(
    request: InferenceRequest,
    models: ModelConfig[],
    strategy: EnsembleStrategy = 'routing',
    reasoning = 'Default fallback routing',
  ): RoutingDecision {
    const estimatedCost = models.reduce(
      (sum, m) => sum + m.costPerToken * request.contextWindow,
      0,
    );
    return {
      requestId: request.id,
      selectedModels: models.map((m) => m.id),
      strategy,
      reasoning,
      estimatedCost,
    };
  }

  async infer(request: InferenceRequest): Promise<EnsembleResult> {
    const decision = this.route(request);
    const start = Date.now();

    logger.debug('Starting inference', {
      requestId: request.id,
      strategy: decision.strategy,
      models: decision.selectedModels,
    });

    const budgets = this.tokenBudgetAllocator(request, decision.selectedModels.map((id) => this.models.get(id)!));
    const responses: ModelResponse[] = decision.selectedModels
      .filter((id) => this.models.has(id))
      .map((id) => this.simulateModelCall(id, request, budgets[id] ?? request.contextWindow));

    responses.forEach((r) => this.updateModelMetrics(r.modelId, r));

    let finalResponse: string;
    switch (decision.strategy) {
      case 'majority_vote':
        finalResponse = this.applyMajorityVote(responses);
        break;
      case 'weighted_average':
        finalResponse = this.applyWeightedAverage(
          responses,
          responses.map((r) => this.scoreResponse(r, request)),
        );
        break;
      case 'best_of_n':
        finalResponse = this.applyBestOfN(responses, responses.length).content;
        break;
      case 'cascade':
        finalResponse = this.applyCascade(responses, request).content;
        break;
      case 'mixture_of_experts':
        finalResponse = this.applyMixtureOfExperts(request, responses);
        break;
      default:
        finalResponse = responses.sort((a, b) => b.confidence - a.confidence)[0]?.content ?? '';
    }

    const consensusScore = this.evaluateConsensus(responses);
    const totalCost = responses.reduce((s, r) => s + r.cost, 0);
    const totalLatencyMs = Date.now() - start;

    this.consensusHistory.push(consensusScore);
    this.costHistory.push(totalCost);
    this.latencyHistory.push(totalLatencyMs);
    this.metrics.totalRequests++;
    this.metrics.avgConsensusScore = this.average(this.consensusHistory);
    this.metrics.avgCost = this.average(this.costHistory);
    this.metrics.avgLatency = this.average(this.latencyHistory);

    const singleModelCost = Math.max(...Array.from(this.models.values()).map((m) => m.costPerToken)) * request.contextWindow;
    this.metrics.costSavings += Math.max(0, singleModelCost - totalCost);

    logger.info('Inference complete', {
      requestId: request.id,
      consensusScore,
      totalCost,
      totalLatencyMs,
    });

    return { requestId: request.id, finalResponse, modelResponses: responses, strategy: decision.strategy, consensusScore, totalCost, totalLatencyMs };
  }

  private simulateModelCall(modelId: string, request: InferenceRequest, tokens: number): ModelResponse {
    const model = this.models.get(modelId)!;
    const latencyMs = model.avgLatencyMs * (0.8 + Math.random() * 0.4);
    const tokensUsed = Math.min(tokens, model.maxTokens);
    const cost = tokensUsed * model.costPerToken;
    const confidence = model.qualityScore * (0.85 + Math.random() * 0.15);
    const contentLength = 50 + Math.floor(Math.random() * 200);
    const content = `[${model.name}] Response to: "${request.prompt.slice(0, 30)}..." (${contentLength} chars, quality=${confidence.toFixed(2)})`;
    return { modelId, content, confidence, latencyMs, tokensUsed, cost, metadata: { model: model.model, provider: model.provider } };
  }

  applyMajorityVote(responses: ModelResponse[]): string {
    if (responses.length === 0) return '';
    if (responses.length === 1) return responses[0].content;
    // Cluster by content similarity using word-overlap Jaccard index
    const tokenSets = responses.map((r) => new Set(r.content.toLowerCase().split(/\s+/)));
    const scores = responses.map((_, i) => {
      return responses.reduce((sum, _, j) => {
        if (i === j) return sum;
        const intersection = [...tokenSets[i]].filter((t) => tokenSets[j].has(t)).length;
        const union = new Set([...tokenSets[i], ...tokenSets[j]]).size;
        return sum + (union > 0 ? intersection / union : 0);
      }, 0);
    });
    const winner = scores.indexOf(Math.max(...scores));
    return responses[winner].content;
  }

  applyWeightedAverage(responses: ModelResponse[], weights: number[]): string {
    if (responses.length === 0) return '';
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight === 0) return responses[0].content;
    // Return the response whose weight is closest to weighted centroid confidence
    const centroid = responses.reduce((s, r, i) => s + r.confidence * (weights[i] / totalWeight), 0);
    const closest = responses.reduce((best, r, i) =>
      Math.abs(r.confidence - centroid) < Math.abs(best.r.confidence - centroid) ? { r, i } : best,
      { r: responses[0], i: 0 },
    );
    return closest.r.content;
  }

  applyBestOfN(responses: ModelResponse[], n: number): ModelResponse {
    const top = responses.slice(0, n).sort((a, b) => b.confidence - a.confidence);
    return top[0] ?? responses[0];
  }

  applyCascade(responses: ModelResponse[], request: InferenceRequest): ModelResponse {
    // Try cheap/fast first; escalate if confidence below quality threshold
    const sorted = responses.sort((a, b) => {
      const modelA = this.models.get(a.modelId);
      const modelB = this.models.get(b.modelId);
      return (modelA?.costPerToken ?? 0) - (modelB?.costPerToken ?? 0);
    });
    for (const response of sorted) {
      if (response.confidence >= request.requiredQuality) return response;
    }
    return sorted[sorted.length - 1] ?? responses[0];
  }

  applyMixtureOfExperts(request: InferenceRequest, responses: ModelResponse[]): string {
    // Weight each expert by specialization match + confidence
    const weights = responses.map((r) => {
      const model = this.models.get(r.modelId);
      const specMatch = model?.specializations.some((s) =>
        s.toLowerCase().includes(request.taskType.toLowerCase()),
      )
        ? 1.5
        : 1.0;
      return r.confidence * specMatch;
    });
    return this.applyWeightedAverage(responses, weights);
  }

  evaluateConsensus(responses: ModelResponse[]): number {
    if (responses.length <= 1) return 1.0;
    // Approximate semantic consensus via pairwise Jaccard similarity
    let totalSim = 0;
    let pairs = 0;
    const tokenSets = responses.map((r) => new Set(r.content.toLowerCase().split(/\s+/)));
    for (let i = 0; i < tokenSets.length; i++) {
      for (let j = i + 1; j < tokenSets.length; j++) {
        const intersection = [...tokenSets[i]].filter((t) => tokenSets[j].has(t)).length;
        const union = new Set([...tokenSets[i], ...tokenSets[j]]).size;
        totalSim += union > 0 ? intersection / union : 0;
        pairs++;
      }
    }
    return pairs > 0 ? totalSim / pairs : 0;
  }

  updateModelMetrics(modelId: string, response: ModelResponse): void {
    const stats = this.modelStats.get(modelId);
    if (!stats) return;
    stats.totalCalls++;
    stats.totalLatencyMs += response.latencyMs;
    stats.totalCost += response.cost;
    stats.totalTokens += response.tokensUsed;
    stats.avgConfidence = (stats.avgConfidence * (stats.totalCalls - 1) + response.confidence) / stats.totalCalls;
    this.metrics.modelUsageDistribution[modelId] = (this.metrics.modelUsageDistribution[modelId] ?? 0) + 1;
    // Update model avgLatencyMs with EMA (α=0.1)
    const model = this.models.get(modelId);
    if (model) {
      model.avgLatencyMs = 0.9 * model.avgLatencyMs + 0.1 * response.latencyMs;
    }
  }

  getOptimalModel(taskType: string): ModelConfig | undefined {
    const candidates = Array.from(this.models.values()).filter((m) =>
      m.specializations.some((s) => s.toLowerCase().includes(taskType.toLowerCase())),
    );
    if (candidates.length === 0) return Array.from(this.models.values()).sort((a, b) => b.qualityScore - a.qualityScore)[0];
    return candidates.sort((a, b) => b.qualityScore - a.qualityScore)[0];
  }

  getMetrics(): EnsembleMetrics {
    return { ...this.metrics, modelUsageDistribution: { ...this.metrics.modelUsageDistribution } };
  }

  private scoreResponse(response: ModelResponse, request: InferenceRequest): number {
    const latencyScore = Math.max(0, 1 - response.latencyMs / request.maxLatencyMs);
    const costScore = Math.max(0, 1 - response.cost / request.maxCostTokens);
    const qualityScore = response.confidence;
    return this.qualityEvaluator.weights[0] * qualityScore +
      this.qualityEvaluator.weights[1] * latencyScore +
      this.qualityEvaluator.weights[2] * costScore +
      this.qualityEvaluator.weights[3] * (response.tokensUsed / request.contextWindow);
  }

  private tokenBudgetAllocator(request: InferenceRequest, models: ModelConfig[]): Record<string, number> {
    const budgets: Record<string, number> = {};
    if (models.length === 0) return budgets;
    // Allocate proportionally to quality score
    const totalQuality = models.reduce((s, m) => s + m.qualityScore, 0);
    const totalBudget = request.maxCostTokens;
    models.forEach((m) => {
      const share = totalQuality > 0 ? m.qualityScore / totalQuality : 1 / models.length;
      const affordableTokens = Math.floor((totalBudget * share) / Math.max(m.costPerToken, 0.000001));
      budgets[m.id] = Math.min(affordableTokens, m.maxTokens, request.contextWindow);
    });
    return budgets;
  }

  private average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const GLOBAL_KEY = '__multiModelEnsemble__';

export function getMultiModelEnsemble(): MultiModelEnsemble {
  const g = globalThis as unknown as Record<string, MultiModelEnsemble>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new MultiModelEnsemble();
    logger.info('MultiModelEnsemble singleton initialised');
  }
  return g[GLOBAL_KEY];
}

export default getMultiModelEnsemble;
