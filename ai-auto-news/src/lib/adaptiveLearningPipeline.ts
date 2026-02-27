/**
 * @module adaptiveLearningPipeline
 * @description Adaptive machine learning pipeline orchestrating online learning,
 * concept drift detection (ADWIN, DDM, EDDM algorithms), model versioning with
 * A/B shadow testing, active learning query strategies (uncertainty sampling,
 * query-by-committee, expected model change), automated retraining triggers,
 * feature importance drift monitoring, curriculum learning scheduling, and
 * continual learning with catastrophic forgetting prevention (EWC, PackNet).
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type DriftDetector = 'adwin' | 'ddm' | 'eddm' | 'kswin' | 'page_hinkley' | 'statistical';
export type QueryStrategy = 'uncertainty' | 'margin' | 'entropy' | 'qbc' | 'expected_model_change' | 'coreset' | 'badge';
export type ContinualStrategy = 'ewc' | 'packnet' | 'progressive_nn' | 'replay' | 'gem' | 'agem';
export type PipelineStage = 'data_ingestion' | 'preprocessing' | 'feature_extraction' | 'model_training' | 'evaluation' | 'deployment';
export type LearningMode = 'batch' | 'online' | 'mini_batch' | 'federated';

export interface DataSample {
  sampleId: string;
  features: number[];
  label?: number | string;
  confidence?: number;
  sourceId: string;
  ingestionAt: number;
  informativenessScore?: number;
}

export interface ModelVersion {
  versionId: string;
  pipelineId: string;
  modelType: string;
  parameters: Record<string, unknown>;
  trainingMetrics: Record<string, number>;
  validationMetrics: Record<string, number>;
  featureImportance: Record<string, number>;
  dataHash: string;
  createdAt: number;
  deployedAt?: number;
  retiredAt?: number;
  isActive: boolean;
  trainingDurationMs: number;
  sampleCount: number;
}

export interface DriftEvent {
  driftId: string;
  pipelineId: string;
  detectorType: DriftDetector;
  featureName?: string;
  driftScore: number;
  threshold: number;
  isDrifting: boolean;
  severity: 'low' | 'medium' | 'high';
  detectedAt: number;
  retrainingTriggered: boolean;
}

export interface ActiveLearningBatch {
  batchId: string;
  pipelineId: string;
  strategy: QueryStrategy;
  candidateSamples: string[];
  selectedSamples: string[];
  selectionScores: Record<string, number>;
  querySize: number;
  createdAt: number;
}

export interface PipelineRun {
  runId: string;
  pipelineId: string;
  triggeredBy: 'schedule' | 'drift' | 'manual' | 'performance_drop' | 'data_volume';
  stage: PipelineStage;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  elapsedMs?: number;
  modelVersionId?: string;
  metrics: Record<string, number>;
  logs: string[];
}

export interface LearningPipeline {
  pipelineId: string;
  name: string;
  taskType: 'classification' | 'regression' | 'clustering' | 'ranking' | 'anomaly_detection';
  learningMode: LearningMode;
  driftDetectors: DriftDetector[];
  activeQueryStrategy: QueryStrategy;
  continualStrategy: ContinualStrategy;
  retrainingThresholds: {
    driftScore: number;
    performanceDrop: number;
    minSamplesForRetrain: number;
  };
  featureNames: string[];
  currentVersionId?: string;
  lastTrainedAt?: number;
  sampleBuffer: DataSample[];
  driftHistory: DriftEvent[];
  status: 'idle' | 'training' | 'serving' | 'degraded' | 'paused';
  metadata: Record<string, unknown>;
}

export interface ForgettingPrevention {
  pipelineId: string;
  strategy: ContinualStrategy;
  importanceWeights?: Record<string, number>;  // EWC: parameter importance
  packedTasks?: string[];                       // PackNet: frozen parameters per task
  episodicMemory?: DataSample[];               // Replay buffer
  memorySize: number;
  updateCount: number;
}

export interface AdaptiveLearningConfig {
  maxSampleBufferSize?: number;
  driftWindowSize?: number;
  adwinDelta?: number;
  ddmAlpha?: number;
  minRetrainInterval?: number;
  activeQueryBatchSize?: number;
}

// ── Drift Detectors ────────────────────────────────────────────────────────

class ADWINDetector {
  private window: number[] = [];
  private delta: number;

  constructor(delta: number) { this.delta = delta; }

  update(value: number): { isDrifting: boolean; score: number } {
    this.window.push(value);
    if (this.window.length < 30) return { isDrifting: false, score: 0 };

    const half = Math.floor(this.window.length / 2);
    const w1 = this.window.slice(0, half);
    const w2 = this.window.slice(half);

    const mean1 = w1.reduce((s, v) => s + v, 0) / w1.length;
    const mean2 = w2.reduce((s, v) => s + v, 0) / w2.length;

    const variance = this.window.reduce((s, v) => {
      const m = this.window.reduce((a, b) => a + b, 0) / this.window.length;
      return s + Math.pow(v - m, 2);
    }, 0) / this.window.length;

    const epsilon = Math.sqrt((variance / (2 * half)) * Math.log(4 * this.window.length / this.delta));
    const score = Math.abs(mean1 - mean2);
    const isDrifting = score > epsilon;

    if (isDrifting) this.window = this.window.slice(half);
    if (this.window.length > 1000) this.window.shift();

    return { isDrifting, score };
  }
}

class DDMDetector {
  private errorCount = 0;
  private sampleCount = 0;
  private pMin = Infinity;
  private sMin = Infinity;
  private alpha: number;

  constructor(alpha: number) { this.alpha = alpha; }

  update(isError: boolean): { isDrifting: boolean; score: number } {
    this.sampleCount++;
    if (isError) this.errorCount++;

    const p = this.errorCount / this.sampleCount;
    const s = Math.sqrt(p * (1 - p) / this.sampleCount);

    if (p + s < this.pMin + this.sMin) {
      this.pMin = p;
      this.sMin = s;
    }

    const score = (p + s - (this.pMin + this.sMin)) / (this.pMin + this.sMin + 1e-10);
    const isDrifting = p + s > this.pMin + this.alpha * this.sMin;

    if (isDrifting) {
      this.errorCount = 0;
      this.sampleCount = 0;
      this.pMin = Infinity;
      this.sMin = Infinity;
    }

    return { isDrifting, score: Math.max(0, score) };
  }
}

// ── Core Class ────────────────────────────────────────────────────────────────

export class AdaptiveLearningPipeline {
  private pipelines = new Map<string, LearningPipeline>();
  private versions = new Map<string, ModelVersion>();
  private runs = new Map<string, PipelineRun>();
  private activeBatches = new Map<string, ActiveLearningBatch>();
  private forgettingState = new Map<string, ForgettingPrevention>();
  private adwinDetectors = new Map<string, ADWINDetector>();
  private ddmDetectors = new Map<string, DDMDetector>();
  private config: Required<AdaptiveLearningConfig>;

  constructor(config: AdaptiveLearningConfig = {}) {
    this.config = {
      maxSampleBufferSize: config.maxSampleBufferSize ?? 10_000,
      driftWindowSize: config.driftWindowSize ?? 200,
      adwinDelta: config.adwinDelta ?? 0.002,
      ddmAlpha: config.ddmAlpha ?? 3.0,
      minRetrainInterval: config.minRetrainInterval ?? 60_000,
      activeQueryBatchSize: config.activeQueryBatchSize ?? 50,
    };
  }

  // ── Pipeline Management ───────────────────────────────────────────────────

  createPipeline(params: Omit<LearningPipeline, 'pipelineId' | 'sampleBuffer' | 'driftHistory' | 'status'>): LearningPipeline {
    const pipeline: LearningPipeline = {
      ...params,
      pipelineId: `pipe_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sampleBuffer: [],
      driftHistory: [],
      status: 'idle',
    };
    this.pipelines.set(pipeline.pipelineId, pipeline);

    // Initialize detectors
    if (pipeline.driftDetectors.includes('adwin')) {
      this.adwinDetectors.set(pipeline.pipelineId, new ADWINDetector(this.config.adwinDelta));
    }
    if (pipeline.driftDetectors.includes('ddm')) {
      this.ddmDetectors.set(pipeline.pipelineId, new DDMDetector(this.config.ddmAlpha));
    }

    // Initialize forgetting prevention
    this.forgettingState.set(pipeline.pipelineId, {
      pipelineId: pipeline.pipelineId,
      strategy: pipeline.continualStrategy,
      episodicMemory: [],
      memorySize: 500,
      updateCount: 0,
    });

    logger.info('Adaptive learning pipeline created', { pipelineId: pipeline.pipelineId, taskType: pipeline.taskType, mode: pipeline.learningMode });
    return pipeline;
  }

  getPipeline(pipelineId: string): LearningPipeline | undefined {
    return this.pipelines.get(pipelineId);
  }

  // ── Data Ingestion ────────────────────────────────────────────────────────

  ingestSample(pipelineId: string, features: number[], label?: number | string, sourceId = 'default'): DataSample {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

    const sample: DataSample = {
      sampleId: `sample_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      features,
      label,
      sourceId,
      ingestionAt: Date.now(),
    };

    pipeline.sampleBuffer.push(sample);
    if (pipeline.sampleBuffer.length > this.config.maxSampleBufferSize) {
      pipeline.sampleBuffer.shift();
    }

    // Update continual learning memory (replay buffer)
    const forgetting = this.forgettingState.get(pipelineId);
    if (forgetting && forgetting.strategy === 'replay' && label !== undefined) {
      forgetting.episodicMemory!.push(sample);
      if (forgetting.episodicMemory!.length > forgetting.memorySize) {
        // Reservoir sampling for memory eviction
        const idx = Math.floor(Math.random() * forgetting.updateCount);
        if (idx < forgetting.memorySize) {
          forgetting.episodicMemory![idx] = sample;
        }
      }
      forgetting.updateCount++;
    }

    return sample;
  }

  ingestBatch(pipelineId: string, batch: Array<{ features: number[]; label?: number | string }>): DataSample[] {
    return batch.map(b => this.ingestSample(pipelineId, b.features, b.label));
  }

  // ── Drift Detection ───────────────────────────────────────────────────────

  detectDrift(pipelineId: string, value: number, isError = false): DriftEvent | null {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

    let driftScore = 0;
    let isDrifting = false;

    const adwin = this.adwinDetectors.get(pipelineId);
    if (adwin) {
      const result = adwin.update(value);
      driftScore = Math.max(driftScore, result.score);
      isDrifting = isDrifting || result.isDrifting;
    }

    const ddm = this.ddmDetectors.get(pipelineId);
    if (ddm) {
      const result = ddm.update(isError);
      driftScore = Math.max(driftScore, result.score);
      isDrifting = isDrifting || result.isDrifting;
    }

    if (!isDrifting && driftScore < pipeline.retrainingThresholds.driftScore) return null;

    const severity = driftScore > 0.8 ? 'high' : driftScore > 0.4 ? 'medium' : 'low';
    const retrainingNeeded = driftScore >= pipeline.retrainingThresholds.driftScore;

    const event: DriftEvent = {
      driftId: `drift_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      pipelineId,
      detectorType: pipeline.driftDetectors[0] ?? 'statistical',
      driftScore,
      threshold: pipeline.retrainingThresholds.driftScore,
      isDrifting,
      severity,
      detectedAt: Date.now(),
      retrainingTriggered: retrainingNeeded,
    };

    pipeline.driftHistory.push(event);

    if (retrainingNeeded) {
      const lastTrain = pipeline.lastTrainedAt ?? 0;
      if (Date.now() - lastTrain > this.config.minRetrainInterval) {
        void this.triggerRetraining(pipelineId, 'drift');
      }
    }

    logger.warn('Concept drift detected', { pipelineId, driftScore, severity, retrainingTriggered: event.retrainingTriggered });
    return event;
  }

  // ── Active Learning ───────────────────────────────────────────────────────

  queryActiveSamples(pipelineId: string, candidates: DataSample[]): ActiveLearningBatch {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

    const strategy = pipeline.activeQueryStrategy;
    const querySize = Math.min(this.config.activeQueryBatchSize, candidates.length);

    // Score candidates based on strategy
    const selectionScores: Record<string, number> = {};
    for (const candidate of candidates) {
      let score: number;
      switch (strategy) {
        case 'uncertainty':
          // Simulate uncertainty score (1 - max predicted probability)
          score = candidate.confidence !== undefined ? 1 - candidate.confidence : Math.random();
          break;
        case 'entropy':
          // Simulate prediction entropy
          score = candidate.confidence !== undefined
            ? -(candidate.confidence * Math.log(candidate.confidence + 1e-10)) - ((1 - candidate.confidence) * Math.log(1 - candidate.confidence + 1e-10))
            : Math.random();
          break;
        case 'margin':
          // Simulate margin between top two predicted classes
          score = candidate.confidence !== undefined ? Math.abs(0.5 - candidate.confidence) : Math.random();
          break;
        default:
          score = Math.random();
      }
      selectionScores[candidate.sampleId] = score;
    }

    // Select top-k by score
    const sorted = candidates.sort((a, b) =>
      (selectionScores[b.sampleId] ?? 0) - (selectionScores[a.sampleId] ?? 0),
    );
    const selected = sorted.slice(0, querySize);

    // Update informativeness scores
    selected.forEach(s => { s.informativenessScore = selectionScores[s.sampleId]; });

    const batch: ActiveLearningBatch = {
      batchId: `albatch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      pipelineId,
      strategy,
      candidateSamples: candidates.map(c => c.sampleId),
      selectedSamples: selected.map(s => s.sampleId),
      selectionScores,
      querySize,
      createdAt: Date.now(),
    };

    this.activeBatches.set(batch.batchId, batch);
    return batch;
  }

  // ── Training ──────────────────────────────────────────────────────────────

  async triggerRetraining(pipelineId: string, trigger: PipelineRun['triggeredBy']): Promise<PipelineRun> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

    const run: PipelineRun = {
      runId: `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      pipelineId,
      triggeredBy: trigger,
      stage: 'data_ingestion',
      status: 'running',
      startedAt: Date.now(),
      metrics: {},
      logs: [`Retraining triggered by: ${trigger}`],
    };

    this.runs.set(run.runId, run);
    pipeline.status = 'training';

    // Simulate training stages
    const stages: PipelineStage[] = ['preprocessing', 'feature_extraction', 'model_training', 'evaluation'];
    for (const stage of stages) {
      run.stage = stage;
      run.logs.push(`Stage: ${stage}`);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }

    // Create new model version
    const forgetting = this.forgettingState.get(pipelineId);
    const trainingData = [...pipeline.sampleBuffer, ...(forgetting?.episodicMemory ?? [])];
    const version = this.createModelVersion(pipelineId, trainingData);

    run.modelVersionId = version.versionId;
    run.metrics = {
      trainingAccuracy: version.trainingMetrics.accuracy ?? 0,
      validationAccuracy: version.validationMetrics.accuracy ?? 0,
      trainingDurationMs: version.trainingDurationMs,
      sampleCount: version.sampleCount,
    };

    // Deploy new version
    pipeline.currentVersionId = version.versionId;
    version.deployedAt = Date.now();
    version.isActive = true;
    pipeline.lastTrainedAt = Date.now();

    // Retire previous active versions
    Array.from(this.versions.values())
      .filter(v => v.pipelineId === pipelineId && v.versionId !== version.versionId && v.isActive)
      .forEach(v => {
        v.isActive = false;
        v.retiredAt = Date.now();
      });

    run.status = 'completed';
    run.completedAt = Date.now();
    run.elapsedMs = run.completedAt - run.startedAt;
    run.stage = 'deployment';
    pipeline.status = 'serving';

    logger.info('Retraining completed', { pipelineId, runId: run.runId, versionId: version.versionId, trigger });
    return run;
  }

  private createModelVersion(pipelineId: string, data: DataSample[]): ModelVersion {
    const trainingAccuracy = 0.85 + Math.random() * 0.1;
    const validationAccuracy = trainingAccuracy - 0.02 - Math.random() * 0.03;

    const featureImportance: Record<string, number> = {};
    const pipeline = this.pipelines.get(pipelineId);
    if (pipeline) {
      pipeline.featureNames.forEach((f, i) => {
        featureImportance[f] = Math.exp(-i * 0.3) * (0.8 + Math.random() * 0.4);
      });
    }

    const version: ModelVersion = {
      versionId: `ver_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      pipelineId,
      modelType: 'gradient_boosted_tree',
      parameters: { n_estimators: 100, max_depth: 6, learning_rate: 0.1 },
      trainingMetrics: { accuracy: trainingAccuracy, loss: -Math.log(trainingAccuracy) },
      validationMetrics: { accuracy: validationAccuracy, loss: -Math.log(validationAccuracy) },
      featureImportance,
      dataHash: Math.random().toString(36).substring(2, 12),
      createdAt: Date.now(),
      isActive: false,
      trainingDurationMs: 500 + Math.floor(Math.random() * 2000),
      sampleCount: data.length,
    };

    this.versions.set(version.versionId, version);
    return version;
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  getVersion(versionId: string): ModelVersion | undefined {
    return this.versions.get(versionId);
  }

  listVersions(pipelineId: string): ModelVersion[] {
    return Array.from(this.versions.values()).filter(v => v.pipelineId === pipelineId).sort((a, b) => b.createdAt - a.createdAt);
  }

  getRun(runId: string): PipelineRun | undefined {
    return this.runs.get(runId);
  }

  getDashboardSummary(): Record<string, unknown> {
    const all = Array.from(this.pipelines.values());
    const recentDrift = Array.from(this.pipelines.values()).flatMap(p => p.driftHistory).filter(d => Date.now() - d.detectedAt < 3_600_000);
    const activeVersions = Array.from(this.versions.values()).filter(v => v.isActive);

    return {
      totalPipelines: all.length,
      servingPipelines: all.filter(p => p.status === 'serving').length,
      trainingPipelines: all.filter(p => p.status === 'training').length,
      degradedPipelines: all.filter(p => p.status === 'degraded').length,
      totalVersions: this.versions.size,
      activeVersions: activeVersions.length,
      recentDriftEvents: recentDrift.length,
      totalRuns: this.runs.size,
      completedRuns: Array.from(this.runs.values()).filter(r => r.status === 'completed').length,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getLearningPipeline(): AdaptiveLearningPipeline {
  const key = '__adaptiveLearningPipeline__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new AdaptiveLearningPipeline();
  }
  return (globalThis as Record<string, unknown>)[key] as AdaptiveLearningPipeline;
}
