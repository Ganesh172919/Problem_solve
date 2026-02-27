import { describe, it, expect, beforeEach } from '@jest/globals';
import { getMultiModelEnsemble } from '../../../src/lib/multiModelEnsemble';
import type { ModelConfig, ModelResponse } from '../../../src/lib/multiModelEnsemble';

const MODEL_A: ModelConfig = {
  id: 'model-a',
  name: 'ModelA',
  provider: 'openai',
  model: 'gpt-4',
  maxTokens: 4096,
  costPerToken: 0.00001,
  avgLatencyMs: 300,
  qualityScore: 0.9,
  specializations: ['summarization', 'qa'],
};

const MODEL_B: ModelConfig = {
  id: 'model-b',
  name: 'ModelB',
  provider: 'anthropic',
  model: 'claude-3',
  maxTokens: 4096,
  costPerToken: 0.000008,
  avgLatencyMs: 400,
  qualityScore: 0.85,
  specializations: ['analysis'],
};

const BASE_REQUEST = {
  id: 'req-1',
  prompt: 'Summarize the article',
  taskType: 'summarization',
  requiredQuality: 0.7,
  maxCostTokens: 1,
  maxLatencyMs: 2000,
  contextWindow: 512,
};

describe('MultiModelEnsemble', () => {
  beforeEach(() => {
    (globalThis as any).__multiModelEnsemble__ = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getMultiModelEnsemble();
    const b = getMultiModelEnsemble();
    expect(a).toBe(b);
  });

  it('registerModel() registers without error', () => {
    const ensemble = getMultiModelEnsemble();
    expect(() => ensemble.registerModel(MODEL_A)).not.toThrow();
  });

  it('route() returns RoutingDecision with selectedModels array', () => {
    const ensemble = getMultiModelEnsemble();
    ensemble.registerModel(MODEL_A);
    ensemble.registerModel(MODEL_B);
    const decision = ensemble.route(BASE_REQUEST);
    expect(decision.requestId).toBe('req-1');
    expect(Array.isArray(decision.selectedModels)).toBe(true);
    expect(decision.selectedModels.length).toBeGreaterThan(0);
    expect(typeof decision.estimatedCost).toBe('number');
  });

  it('evaluateConsensus() returns number between 0 and 1', () => {
    const ensemble = getMultiModelEnsemble();
    const responses: ModelResponse[] = [
      { modelId: 'a', content: 'hello world foo', confidence: 0.9, latencyMs: 100, tokensUsed: 10, cost: 0.01, metadata: {} },
      { modelId: 'b', content: 'hello world bar', confidence: 0.8, latencyMs: 120, tokensUsed: 10, cost: 0.01, metadata: {} },
    ];
    const score = ensemble.evaluateConsensus(responses);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('getOptimalModel() returns undefined when no models registered', () => {
    const ensemble = getMultiModelEnsemble();
    const result = ensemble.getOptimalModel('summarization');
    expect(result).toBeUndefined();
  });

  it('getOptimalModel() returns a config when models exist', () => {
    const ensemble = getMultiModelEnsemble();
    ensemble.registerModel(MODEL_A);
    const result = ensemble.getOptimalModel('summarization');
    expect(result).toBeDefined();
    expect(result!.id).toBe('model-a');
  });

  it('getMetrics() returns correct shape with numeric fields', () => {
    const ensemble = getMultiModelEnsemble();
    const metrics = ensemble.getMetrics();
    expect(typeof metrics.totalRequests).toBe('number');
    expect(typeof metrics.avgConsensusScore).toBe('number');
    expect(typeof metrics.avgCost).toBe('number');
    expect(typeof metrics.avgLatency).toBe('number');
    expect(typeof metrics.costSavings).toBe('number');
    expect(typeof metrics.modelUsageDistribution).toBe('object');
  });

  it('applyMajorityVote() returns most common response', () => {
    const ensemble = getMultiModelEnsemble();
    const responses: ModelResponse[] = [
      { modelId: 'a', content: 'the sky is blue', confidence: 0.9, latencyMs: 100, tokensUsed: 5, cost: 0.01, metadata: {} },
      { modelId: 'b', content: 'the sky is blue today', confidence: 0.8, latencyMs: 110, tokensUsed: 5, cost: 0.01, metadata: {} },
      { modelId: 'c', content: 'unrelated content entirely', confidence: 0.7, latencyMs: 120, tokensUsed: 5, cost: 0.01, metadata: {} },
    ];
    const result = ensemble.applyMajorityVote(responses);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('applyBestOfN() returns highest confidence response', () => {
    const ensemble = getMultiModelEnsemble();
    const responses: ModelResponse[] = [
      { modelId: 'a', content: 'response A', confidence: 0.6, latencyMs: 100, tokensUsed: 5, cost: 0.01, metadata: {} },
      { modelId: 'b', content: 'response B', confidence: 0.95, latencyMs: 110, tokensUsed: 5, cost: 0.01, metadata: {} },
      { modelId: 'c', content: 'response C', confidence: 0.75, latencyMs: 120, tokensUsed: 5, cost: 0.01, metadata: {} },
    ];
    const best = ensemble.applyBestOfN(responses, responses.length);
    expect(best.confidence).toBe(0.95);
    expect(best.content).toBe('response B');
  });
});
