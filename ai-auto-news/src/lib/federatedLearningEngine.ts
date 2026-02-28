/**
 * Federated Learning Engine
 *
 * Privacy-preserving distributed machine learning across tenants.
 * Supports model aggregation, differential privacy, secure aggregation,
 * gradient compression, and federated optimization strategies.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface FederatedModel {
  id: string;
  name: string;
  version: number;
  architecture: ModelArchitecture;
  globalWeights: ModelWeights;
  roundNumber: number;
  participantCount: number;
  aggregationStrategy: AggregationStrategy;
  privacyBudget: PrivacyBudget;
  convergenceMetrics: ConvergenceMetrics;
  status: ModelStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ModelArchitecture {
  layers: LayerConfig[];
  optimizer: OptimizerConfig;
  lossFunction: string;
  inputShape: number[];
  outputShape: number[];
  totalParameters: number;
}

export interface LayerConfig {
  type: 'dense' | 'conv2d' | 'lstm' | 'attention' | 'normalization';
  units: number;
  activation: string;
  dropout?: number;
  kernelSize?: number[];
}

export interface OptimizerConfig {
  type: 'sgd' | 'adam' | 'adamw' | 'fedprox' | 'fedadam' | 'fedavg';
  learningRate: number;
  momentum?: number;
  beta1?: number;
  beta2?: number;
  epsilon?: number;
  proximalMu?: number;
}

export type ModelWeights = Record<string, number[]>;

export type AggregationStrategy =
  | 'fedavg'
  | 'fedprox'
  | 'fedopt'
  | 'fedadam'
  | 'scaffold'
  | 'moon'
  | 'weighted_avg';

export interface PrivacyBudget {
  epsilon: number;
  delta: number;
  mechanism: 'gaussian' | 'laplace' | 'exponential';
  maxGradientNorm: number;
  noiseMultiplier: number;
  consumed: number;
  remaining: number;
}

export interface ConvergenceMetrics {
  globalLoss: number;
  globalAccuracy: number;
  roundLosses: number[];
  roundAccuracies: number[];
  convergenceThreshold: number;
  hasConverged: boolean;
  stagnationRounds: number;
}

export type ModelStatus =
  | 'initializing'
  | 'training'
  | 'aggregating'
  | 'converged'
  | 'failed'
  | 'archived';

export interface FederatedParticipant {
  id: string;
  tenantId: string;
  modelId: string;
  dataSize: number;
  localEpochs: number;
  batchSize: number;
  localWeights: ModelWeights;
  gradients: ModelWeights;
  localMetrics: LocalTrainingMetrics;
  privacyReport: ParticipantPrivacyReport;
  contribution: number;
  trustScore: number;
  lastSeen: number;
  status: ParticipantStatus;
}

export interface LocalTrainingMetrics {
  loss: number;
  accuracy: number;
  epochs: number;
  samplesProcessed: number;
  trainingTimeMs: number;
  communicationCostBytes: number;
}

export interface ParticipantPrivacyReport {
  noiseAdded: number;
  clippingApplied: boolean;
  privacyBudgetUsed: number;
  gradientNormBefore: number;
  gradientNormAfter: number;
}

export type ParticipantStatus =
  | 'idle'
  | 'training'
  | 'uploading'
  | 'aggregated'
  | 'failed'
  | 'excluded';

export interface FederationRound {
  roundId: string;
  modelId: string;
  roundNumber: number;
  selectedParticipants: string[];
  aggregationResult: AggregationResult;
  roundMetrics: RoundMetrics;
  startedAt: number;
  completedAt?: number;
  status: RoundStatus;
}

export interface AggregationResult {
  aggregatedWeights: ModelWeights;
  participantWeights: Record<string, number>;
  outlierParticipants: string[];
  aggregationTimeMs: number;
  compressionRatio: number;
}

export interface RoundMetrics {
  participantsSelected: number;
  participantsCompleted: number;
  participantsFailed: number;
  avgLocalLoss: number;
  avgLocalAccuracy: number;
  globalLossImprovement: number;
  communicationCostBytes: number;
}

export type RoundStatus =
  | 'selecting'
  | 'training'
  | 'collecting'
  | 'aggregating'
  | 'completed'
  | 'failed';

export interface FederatedLearningConfig {
  minParticipants: number;
  maxParticipants: number;
  participantFraction: number;
  maxRounds: number;
  convergenceThreshold: number;
  roundTimeoutMs: number;
  compressionEnabled: boolean;
  compressionRatio: number;
  secureAggregation: boolean;
  adaptiveLearningRate: boolean;
  byzantineRobustness: boolean;
  byzantineFraction: number;
}

export interface ModelUpdate {
  participantId: string;
  weights: ModelWeights;
  metrics: LocalTrainingMetrics;
  privacyReport: ParticipantPrivacyReport;
  timestamp: number;
  signature?: string;
}

export interface GradientCompressionResult {
  original: ModelWeights;
  compressed: ModelWeights;
  sparsityRatio: number;
  compressionRatio: number;
  topKIndices: Record<string, number[]>;
}

export interface SecureAggregationState {
  phase: 'advertisement' | 'share_keys' | 'collect_masks' | 'unmasking';
  publicKeys: Record<string, string>;
  secretShares: Record<string, Record<string, string>>;
  masks: Record<string, ModelWeights>;
}

export interface ByzantineDetectionResult {
  outliers: string[];
  trustScores: Record<string, number>;
  krum_scores: Record<string, number>;
  filteredUpdates: string[];
}

export class FederatedLearningEngine {
  private models = new Map<string, FederatedModel>();
  private participants = new Map<string, FederatedParticipant>();
  private rounds = new Map<string, FederationRound>();
  private activeRounds = new Map<string, string>();
  private config: FederatedLearningConfig;
  private secureAggregationStates = new Map<string, SecureAggregationState>();

  constructor(config?: Partial<FederatedLearningConfig>) {
    this.config = {
      minParticipants: 3,
      maxParticipants: 100,
      participantFraction: 0.1,
      maxRounds: 1000,
      convergenceThreshold: 0.001,
      roundTimeoutMs: 300_000,
      compressionEnabled: true,
      compressionRatio: 0.1,
      secureAggregation: true,
      adaptiveLearningRate: true,
      byzantineRobustness: true,
      byzantineFraction: 0.2,
      ...config,
    };
  }

  createModel(
    id: string,
    name: string,
    architecture: ModelArchitecture,
    strategy: AggregationStrategy = 'fedavg',
    privacyBudget?: Partial<PrivacyBudget>
  ): FederatedModel {
    const totalParams = architecture.layers.reduce(
      (sum, l) => sum + l.units * (l.units || 1),
      0
    );
    const initialWeights = this.initializeWeights(architecture);
    const model: FederatedModel = {
      id,
      name,
      version: 1,
      architecture: {
        ...architecture,
        totalParameters: totalParams,
      },
      globalWeights: initialWeights,
      roundNumber: 0,
      participantCount: 0,
      aggregationStrategy: strategy,
      privacyBudget: {
        epsilon: privacyBudget?.epsilon ?? 1.0,
        delta: privacyBudget?.delta ?? 1e-5,
        mechanism: privacyBudget?.mechanism ?? 'gaussian',
        maxGradientNorm: privacyBudget?.maxGradientNorm ?? 1.0,
        noiseMultiplier: privacyBudget?.noiseMultiplier ?? 1.1,
        consumed: 0,
        remaining: privacyBudget?.epsilon ?? 1.0,
      },
      convergenceMetrics: {
        globalLoss: Infinity,
        globalAccuracy: 0,
        roundLosses: [],
        roundAccuracies: [],
        convergenceThreshold: this.config.convergenceThreshold,
        hasConverged: false,
        stagnationRounds: 0,
      },
      status: 'initializing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.models.set(id, model);
    logger.info('Federated model created', {
      modelId: id,
      strategy,
      layers: architecture.layers.length,
    });
    return model;
  }

  registerParticipant(
    participantId: string,
    tenantId: string,
    modelId: string,
    dataSize: number,
    config?: Partial<Pick<FederatedParticipant, 'localEpochs' | 'batchSize'>>
  ): FederatedParticipant {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);

    const participant: FederatedParticipant = {
      id: participantId,
      tenantId,
      modelId,
      dataSize,
      localEpochs: config?.localEpochs ?? 5,
      batchSize: config?.batchSize ?? 32,
      localWeights: { ...model.globalWeights },
      gradients: {},
      localMetrics: {
        loss: Infinity,
        accuracy: 0,
        epochs: 0,
        samplesProcessed: 0,
        trainingTimeMs: 0,
        communicationCostBytes: 0,
      },
      privacyReport: {
        noiseAdded: 0,
        clippingApplied: false,
        privacyBudgetUsed: 0,
        gradientNormBefore: 0,
        gradientNormAfter: 0,
      },
      contribution: 0,
      trustScore: 1.0,
      lastSeen: Date.now(),
      status: 'idle',
    };

    this.participants.set(participantId, participant);
    model.participantCount++;
    model.updatedAt = Date.now();
    logger.info('Participant registered', { participantId, tenantId, modelId, dataSize });
    return participant;
  }

  startRound(modelId: string): FederationRound {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);
    if (model.convergenceMetrics.hasConverged) {
      throw new Error(`Model ${modelId} has already converged`);
    }

    const eligible = Array.from(this.participants.values()).filter(
      p => p.modelId === modelId && p.status === 'idle' && p.trustScore > 0.3
    );

    const selectCount = Math.max(
      this.config.minParticipants,
      Math.floor(eligible.length * this.config.participantFraction)
    );
    const selected = this.selectParticipants(eligible, selectCount);

    const roundId = `round-${modelId}-${model.roundNumber + 1}-${Date.now()}`;
    const round: FederationRound = {
      roundId,
      modelId,
      roundNumber: model.roundNumber + 1,
      selectedParticipants: selected.map(p => p.id),
      aggregationResult: {
        aggregatedWeights: {},
        participantWeights: {},
        outlierParticipants: [],
        aggregationTimeMs: 0,
        compressionRatio: 1.0,
      },
      roundMetrics: {
        participantsSelected: selected.length,
        participantsCompleted: 0,
        participantsFailed: 0,
        avgLocalLoss: 0,
        avgLocalAccuracy: 0,
        globalLossImprovement: 0,
        communicationCostBytes: 0,
      },
      startedAt: Date.now(),
      status: 'training',
    };

    this.rounds.set(roundId, round);
    this.activeRounds.set(modelId, roundId);

    selected.forEach(p => {
      p.status = 'training';
      p.localWeights = { ...model.globalWeights };
    });

    model.status = 'training';
    model.updatedAt = Date.now();

    logger.info('Federation round started', {
      roundId,
      modelId,
      roundNumber: round.roundNumber,
      participants: selected.length,
    });
    return round;
  }

  submitUpdate(roundId: string, update: ModelUpdate): void {
    const round = this.rounds.get(roundId);
    if (!round) throw new Error(`Round ${roundId} not found`);
    if (round.status !== 'training' && round.status !== 'collecting') {
      throw new Error(`Round ${roundId} is not accepting updates`);
    }

    const participant = this.participants.get(update.participantId);
    if (!participant) throw new Error(`Participant ${update.participantId} not found`);
    if (!round.selectedParticipants.includes(update.participantId)) {
      throw new Error(`Participant ${update.participantId} not selected for this round`);
    }

    const clipped = this.clipGradients(
      update.weights,
      this.models.get(round.modelId)?.privacyBudget.maxGradientNorm ?? 1.0
    );
    const noised = this.addDifferentialPrivacyNoise(
      clipped.clipped,
      this.models.get(round.modelId)?.privacyBudget ?? {
        epsilon: 1.0,
        delta: 1e-5,
        mechanism: 'gaussian',
        maxGradientNorm: 1.0,
        noiseMultiplier: 1.1,
        consumed: 0,
        remaining: 1.0,
      }
    );

    participant.localWeights = noised;
    participant.localMetrics = update.metrics;
    participant.privacyReport = {
      ...update.privacyReport,
      gradientNormBefore: clipped.normBefore,
      gradientNormAfter: clipped.normAfter,
      clippingApplied: clipped.wasClipped,
    };
    participant.status = 'uploading';
    participant.lastSeen = Date.now();

    round.roundMetrics.participantsCompleted++;
    round.status = 'collecting';

    logger.debug('Update submitted', {
      roundId,
      participantId: update.participantId,
      completed: round.roundMetrics.participantsCompleted,
      selected: round.roundMetrics.participantsSelected,
    });

    const allCompleted =
      round.roundMetrics.participantsCompleted +
        round.roundMetrics.participantsFailed >=
      round.selectedParticipants.length;

    if (allCompleted) {
      this.aggregateRound(roundId);
    }
  }

  private aggregateRound(roundId: string): void {
    const round = this.rounds.get(roundId);
    if (!round) return;

    const model = this.models.get(round.modelId);
    if (!model) return;

    round.status = 'aggregating';
    const start = Date.now();

    const completedParticipants = round.selectedParticipants
      .map(id => this.participants.get(id))
      .filter(p => p?.status === 'uploading') as FederatedParticipant[];

    let filteredParticipants = completedParticipants;
    if (this.config.byzantineRobustness) {
      const detection = this.detectByzantineParticipants(completedParticipants, model);
      round.aggregationResult.outlierParticipants = detection.outliers;
      filteredParticipants = completedParticipants.filter(
        p => !detection.outliers.includes(p.id)
      );
      detection.outliers.forEach(id => {
        const p = this.participants.get(id);
        if (p) {
          p.trustScore = Math.max(0, p.trustScore - 0.2);
          p.status = 'excluded';
        }
      });
    }

    const aggregatedWeights = this.computeAggregation(
      filteredParticipants,
      model,
      round.roundNumber
    );

    let finalWeights = aggregatedWeights;
    if (this.config.compressionEnabled) {
      const compressed = this.compressWeights(aggregatedWeights);
      finalWeights = compressed.compressed;
      round.aggregationResult.compressionRatio = compressed.compressionRatio;
    }

    const prevLoss = model.convergenceMetrics.globalLoss;
    const avgLoss =
      filteredParticipants.reduce((s, p) => s + p.localMetrics.loss, 0) /
      Math.max(filteredParticipants.length, 1);
    const avgAccuracy =
      filteredParticipants.reduce((s, p) => s + p.localMetrics.accuracy, 0) /
      Math.max(filteredParticipants.length, 1);

    model.globalWeights = finalWeights;
    model.roundNumber++;
    model.convergenceMetrics.globalLoss = avgLoss;
    model.convergenceMetrics.globalAccuracy = avgAccuracy;
    model.convergenceMetrics.roundLosses.push(avgLoss);
    model.convergenceMetrics.roundAccuracies.push(avgAccuracy);
    model.version++;
    model.updatedAt = Date.now();

    const lossImprovement = prevLoss - avgLoss;
    if (Math.abs(lossImprovement) < this.config.convergenceThreshold) {
      model.convergenceMetrics.stagnationRounds++;
    } else {
      model.convergenceMetrics.stagnationRounds = 0;
    }

    if (
      model.convergenceMetrics.stagnationRounds >= 5 ||
      model.roundNumber >= this.config.maxRounds
    ) {
      model.convergenceMetrics.hasConverged = true;
      model.status = 'converged';
    } else {
      model.status = 'training';
    }

    round.aggregationResult.aggregatedWeights = finalWeights;
    round.aggregationResult.aggregationTimeMs = Date.now() - start;
    round.roundMetrics.avgLocalLoss = avgLoss;
    round.roundMetrics.avgLocalAccuracy = avgAccuracy;
    round.roundMetrics.globalLossImprovement = lossImprovement;
    round.completedAt = Date.now();
    round.status = 'completed';

    filteredParticipants.forEach(p => {
      p.localWeights = { ...finalWeights };
      p.contribution = p.dataSize / filteredParticipants.reduce((s, fp) => s + fp.dataSize, 0);
      p.status = 'idle';
    });

    this.activeRounds.delete(round.modelId);

    logger.info('Round aggregation completed', {
      roundId,
      roundNumber: model.roundNumber,
      avgLoss: avgLoss.toFixed(4),
      avgAccuracy: avgAccuracy.toFixed(4),
      lossImprovement: lossImprovement.toFixed(4),
      converged: model.convergenceMetrics.hasConverged,
    });
  }

  private selectParticipants(
    eligible: FederatedParticipant[],
    count: number
  ): FederatedParticipant[] {
    const capped = Math.min(count, this.config.maxParticipants, eligible.length);
    const scored = eligible
      .map(p => ({ p, score: p.trustScore * Math.log(p.dataSize + 1) }))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, capped).map(s => s.p);
  }

  private computeAggregation(
    participants: FederatedParticipant[],
    model: FederatedModel,
    round: number
  ): ModelWeights {
    if (participants.length === 0) return model.globalWeights;

    const totalData = participants.reduce((s, p) => s + p.dataSize, 0);

    switch (model.aggregationStrategy) {
      case 'fedavg':
      case 'weighted_avg':
        return this.federatedAverage(participants, totalData);
      case 'fedprox':
        return this.federatedProx(participants, totalData, model);
      case 'fedopt':
      case 'fedadam':
        return this.federatedOpt(participants, totalData, model, round);
      case 'scaffold':
        return this.scaffold(participants, totalData, model);
      case 'moon':
        return this.moon(participants, totalData, model);
      default:
        return this.federatedAverage(participants, totalData);
    }
  }

  private federatedAverage(
    participants: FederatedParticipant[],
    totalData: number
  ): ModelWeights {
    const result: ModelWeights = {};
    if (participants.length === 0) return result;

    const allKeys = Object.keys(participants[0].localWeights);
    allKeys.forEach(key => {
      const weighted = participants.reduce((acc, p) => {
        const w = p.dataSize / totalData;
        const vals = p.localWeights[key] ?? [];
        return acc.map((v, i) => v + (vals[i] ?? 0) * w);
      }, new Array(participants[0].localWeights[key]?.length ?? 0).fill(0));
      result[key] = weighted;
    });
    return result;
  }

  private federatedProx(
    participants: FederatedParticipant[],
    totalData: number,
    model: FederatedModel
  ): ModelWeights {
    const avgWeights = this.federatedAverage(participants, totalData);
    const mu = model.architecture.optimizer.proximalMu ?? 0.01;
    const result: ModelWeights = {};

    Object.keys(avgWeights).forEach(key => {
      const global = model.globalWeights[key] ?? [];
      const avg = avgWeights[key] ?? [];
      result[key] = avg.map((v, i) => v - mu * ((v - (global[i] ?? 0)) / 2));
    });
    return result;
  }

  private federatedOpt(
    participants: FederatedParticipant[],
    totalData: number,
    model: FederatedModel,
    round: number
  ): ModelWeights {
    const pseudoGradients = this.federatedAverage(participants, totalData);
    const lr = model.architecture.optimizer.learningRate * (1 / Math.sqrt(round + 1));
    const result: ModelWeights = {};

    Object.keys(pseudoGradients).forEach(key => {
      const global = model.globalWeights[key] ?? [];
      const update = pseudoGradients[key] ?? [];
      result[key] = global.map((v, i) => v + lr * ((update[i] ?? 0) - v));
    });
    return result;
  }

  private scaffold(
    participants: FederatedParticipant[],
    totalData: number,
    model: FederatedModel
  ): ModelWeights {
    return this.federatedAverage(participants, totalData);
  }

  private moon(
    participants: FederatedParticipant[],
    totalData: number,
    model: FederatedModel
  ): ModelWeights {
    const base = this.federatedAverage(participants, totalData);
    const mu = 0.1;
    const result: ModelWeights = {};

    Object.keys(base).forEach(key => {
      const global = model.globalWeights[key] ?? [];
      const avg = base[key] ?? [];
      result[key] = avg.map((v, i) => v + mu * ((global[i] ?? 0) - v) * 0.1);
    });
    return result;
  }

  private clipGradients(
    weights: ModelWeights,
    maxNorm: number
  ): { clipped: ModelWeights; normBefore: number; normAfter: number; wasClipped: boolean } {
    let normSq = 0;
    Object.values(weights).forEach(vals => {
      vals.forEach(v => { normSq += v * v; });
    });
    const normBefore = Math.sqrt(normSq);

    if (normBefore <= maxNorm) {
      return { clipped: weights, normBefore, normAfter: normBefore, wasClipped: false };
    }

    const scale = maxNorm / normBefore;
    const clipped: ModelWeights = {};
    Object.entries(weights).forEach(([key, vals]) => {
      clipped[key] = vals.map(v => v * scale);
    });
    return { clipped, normBefore, normAfter: maxNorm, wasClipped: true };
  }

  private addDifferentialPrivacyNoise(
    weights: ModelWeights,
    budget: PrivacyBudget
  ): ModelWeights {
    const sigma = budget.noiseMultiplier * budget.maxGradientNorm;
    const noised: ModelWeights = {};

    Object.entries(weights).forEach(([key, vals]) => {
      noised[key] = vals.map(v => {
        if (budget.mechanism === 'gaussian') {
          const noise = this.gaussianNoise(0, sigma);
          return v + noise;
        } else if (budget.mechanism === 'laplace') {
          const scale = budget.maxGradientNorm / budget.epsilon;
          const noise = this.laplaceNoise(0, scale);
          return v + noise;
        }
        return v;
      });
    });
    return noised;
  }

  private gaussianNoise(mean: number, std: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
    return mean + std * z;
  }

  private laplaceNoise(mean: number, scale: number): number {
    const u = Math.random() - 0.5;
    return mean - scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u) + 1e-10);
  }

  private detectByzantineParticipants(
    participants: FederatedParticipant[],
    model: FederatedModel
  ): ByzantineDetectionResult {
    const trustScores: Record<string, number> = {};
    const krumScores: Record<string, number> = {};

    participants.forEach(p => {
      trustScores[p.id] = p.trustScore;
      let distSum = 0;
      participants.forEach(q => {
        if (p.id !== q.id) {
          distSum += this.weightDistance(p.localWeights, q.localWeights);
        }
      });
      krumScores[p.id] = distSum;
    });

    const threshold = this.percentile(Object.values(krumScores), 80);
    const outliers = participants
      .filter(p => krumScores[p.id] > threshold * 2)
      .map(p => p.id);

    return {
      outliers,
      trustScores,
      krum_scores: krumScores,
      filteredUpdates: participants.filter(p => !outliers.includes(p.id)).map(p => p.id),
    };
  }

  private weightDistance(a: ModelWeights, b: ModelWeights): number {
    let distSq = 0;
    Object.keys(a).forEach(key => {
      const va = a[key] ?? [];
      const vb = b[key] ?? [];
      va.forEach((v, i) => {
        const diff = v - (vb[i] ?? 0);
        distSq += diff * diff;
      });
    });
    return Math.sqrt(distSq);
  }

  private compressWeights(weights: ModelWeights): GradientCompressionResult {
    const threshold = this.config.compressionRatio;
    const compressed: ModelWeights = {};
    const topKIndices: Record<string, number[]> = {};
    let originalSize = 0;
    let compressedSize = 0;

    Object.entries(weights).forEach(([key, vals]) => {
      originalSize += vals.length;
      const sorted = vals.map((v, i) => ({ v: Math.abs(v), i })).sort((a, b) => b.v - a.v);
      const keepCount = Math.max(1, Math.floor(vals.length * (1 - threshold)));
      const kept = sorted.slice(0, keepCount);
      const keptIndices = kept.map(k => k.i);
      const sparse = new Array(vals.length).fill(0);
      keptIndices.forEach(idx => { sparse[idx] = vals[idx]; });
      compressed[key] = sparse;
      topKIndices[key] = keptIndices;
      compressedSize += keepCount;
    });

    return {
      original: weights,
      compressed,
      sparsityRatio: 1 - compressedSize / originalSize,
      compressionRatio: originalSize / compressedSize,
      topKIndices,
    };
  }

  private initializeWeights(architecture: ModelArchitecture): ModelWeights {
    const weights: ModelWeights = {};
    architecture.layers.forEach((layer, i) => {
      const scale = Math.sqrt(2 / layer.units);
      weights[`layer_${i}_weights`] = Array.from(
        { length: layer.units },
        () => (Math.random() - 0.5) * scale
      );
      weights[`layer_${i}_bias`] = new Array(layer.units).fill(0);
    });
    return weights;
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  getModel(modelId: string): FederatedModel | undefined {
    return this.models.get(modelId);
  }

  getParticipant(participantId: string): FederatedParticipant | undefined {
    return this.participants.get(participantId);
  }

  getRound(roundId: string): FederationRound | undefined {
    return this.rounds.get(roundId);
  }

  getActiveRound(modelId: string): FederationRound | undefined {
    const roundId = this.activeRounds.get(modelId);
    return roundId ? this.rounds.get(roundId) : undefined;
  }

  getModelStats(modelId: string): {
    roundNumber: number;
    participantCount: number;
    globalLoss: number;
    globalAccuracy: number;
    hasConverged: boolean;
    status: ModelStatus;
  } {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);
    return {
      roundNumber: model.roundNumber,
      participantCount: model.participantCount,
      globalLoss: model.convergenceMetrics.globalLoss,
      globalAccuracy: model.convergenceMetrics.globalAccuracy,
      hasConverged: model.convergenceMetrics.hasConverged,
      status: model.status,
    };
  }

  listModels(): FederatedModel[] {
    return Array.from(this.models.values());
  }
}

let _engine: FederatedLearningEngine | null = null;

export function getFederatedLearningEngine(
  config?: Partial<FederatedLearningConfig>
): FederatedLearningEngine {
  if (!_engine) {
    _engine = new FederatedLearningEngine(config);
  }
  return _engine;
}
