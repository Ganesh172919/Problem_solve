import { describe, it, expect, beforeEach } from '@jest/globals';
import { FederatedLearningEngine, FederatedModel, FederatedParticipant, ModelArchitecture } from '@/lib/federatedLearningEngine';

describe('FederatedLearningEngine', () => {
  let engine: FederatedLearningEngine;

  const sampleArchitecture: ModelArchitecture = {
    layers: [
      { type: 'dense', units: 64, activation: 'relu' },
      { type: 'dense', units: 32, activation: 'relu' },
      { type: 'dense', units: 10, activation: 'softmax' },
    ],
    optimizer: { type: 'fedavg', learningRate: 0.01 },
    lossFunction: 'cross_entropy',
    inputShape: [784],
    outputShape: [10],
    totalParameters: 0,
  };

  beforeEach(() => {
    engine = new FederatedLearningEngine({
      minParticipants: 2,
      participantFraction: 1.0,
    });
  });

  describe('createModel', () => {
    it('should create a federated model with initial weights', () => {
      const model = engine.createModel('model-1', 'Test Model', sampleArchitecture);
      expect(model.id).toBe('model-1');
      expect(model.name).toBe('Test Model');
      expect(model.status).toBe('initializing');
      expect(model.roundNumber).toBe(0);
      expect(Object.keys(model.globalWeights).length).toBeGreaterThan(0);
    });

    it('should default to fedavg strategy', () => {
      const model = engine.createModel('model-2', 'Test', sampleArchitecture);
      expect(model.aggregationStrategy).toBe('fedavg');
    });

    it('should accept custom aggregation strategy', () => {
      const model = engine.createModel('model-3', 'Test', sampleArchitecture, 'fedprox');
      expect(model.aggregationStrategy).toBe('fedprox');
    });

    it('should set privacy budget defaults', () => {
      const model = engine.createModel('model-4', 'Test', sampleArchitecture);
      expect(model.privacyBudget.epsilon).toBe(1.0);
      expect(model.privacyBudget.noiseMultiplier).toBe(1.1);
      expect(model.privacyBudget.remaining).toBe(1.0);
    });

    it('should initialize convergence metrics correctly', () => {
      const model = engine.createModel('model-5', 'Test', sampleArchitecture);
      expect(model.convergenceMetrics.hasConverged).toBe(false);
      expect(model.convergenceMetrics.globalLoss).toBe(Infinity);
      expect(model.convergenceMetrics.roundLosses).toHaveLength(0);
    });
  });

  describe('registerParticipant', () => {
    it('should register a participant for a model', () => {
      engine.createModel('m1', 'M1', sampleArchitecture);
      const p = engine.registerParticipant('p1', 'tenant-1', 'm1', 1000);
      expect(p.id).toBe('p1');
      expect(p.tenantId).toBe('tenant-1');
      expect(p.modelId).toBe('m1');
      expect(p.dataSize).toBe(1000);
      expect(p.status).toBe('idle');
      expect(p.trustScore).toBe(1.0);
    });

    it('should increment model participant count', () => {
      engine.createModel('m2', 'M2', sampleArchitecture);
      engine.registerParticipant('p1', 'tenant-1', 'm2', 1000);
      engine.registerParticipant('p2', 'tenant-2', 'm2', 500);
      const model = engine.getModel('m2');
      expect(model?.participantCount).toBe(2);
    });

    it('should throw if model not found', () => {
      expect(() => engine.registerParticipant('p1', 't1', 'nonexistent', 100)).toThrow('Model nonexistent not found');
    });

    it('should copy global weights to participant', () => {
      engine.createModel('m3', 'M3', sampleArchitecture);
      const p = engine.registerParticipant('p1', 't1', 'm3', 100);
      const model = engine.getModel('m3');
      expect(Object.keys(p.localWeights)).toEqual(Object.keys(model!.globalWeights));
    });
  });

  describe('startRound', () => {
    beforeEach(() => {
      engine.createModel('m1', 'M1', sampleArchitecture);
      engine.registerParticipant('p1', 't1', 'm1', 1000);
      engine.registerParticipant('p2', 't2', 'm1', 800);
    });

    it('should start a federation round', () => {
      const round = engine.startRound('m1');
      expect(round.roundNumber).toBe(1);
      expect(round.status).toBe('training');
      expect(round.selectedParticipants.length).toBeGreaterThanOrEqual(2);
    });

    it('should throw if model not found', () => {
      expect(() => engine.startRound('nonexistent')).toThrow('Model nonexistent not found');
    });

    it('should set model status to training', () => {
      engine.startRound('m1');
      const model = engine.getModel('m1');
      expect(model?.status).toBe('training');
    });

    it('should return active round', () => {
      const round = engine.startRound('m1');
      const activeRound = engine.getActiveRound('m1');
      expect(activeRound?.roundId).toBe(round.roundId);
    });
  });

  describe('getModelStats', () => {
    it('should return model statistics', () => {
      engine.createModel('m1', 'M1', sampleArchitecture);
      const stats = engine.getModelStats('m1');
      expect(stats.roundNumber).toBe(0);
      expect(stats.hasConverged).toBe(false);
      expect(stats.status).toBe('initializing');
    });

    it('should throw if model not found', () => {
      expect(() => engine.getModelStats('nonexistent')).toThrow('Model nonexistent not found');
    });
  });

  describe('listModels', () => {
    it('should list all models', () => {
      engine.createModel('m1', 'M1', sampleArchitecture);
      engine.createModel('m2', 'M2', sampleArchitecture);
      const models = engine.listModels();
      expect(models.length).toBeGreaterThanOrEqual(2);
    });
  });
});
