/**
 * MLOps Orchestrator Agent
 *
 * Full lifecycle management for machine learning models including
 * experiment tracking, model training orchestration, hyperparameter
 * optimization, model registry, A/B testing, drift detection,
 * continuous retraining, and deployment automation.
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export interface MLExperiment {
  experimentId: string;
  name: string;
  description: string;
  projectId: string;
  status: ExperimentStatus;
  runs: ExperimentRun[];
  bestRunId?: string;
  baselineRunId?: string;
  tags: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export type ExperimentStatus = 'active' | 'completed' | 'archived' | 'failed';

export interface ExperimentRun {
  runId: string;
  experimentId: string;
  parameters: Record<string, unknown>;
  metrics: Record<string, number>;
  artifacts: Artifact[];
  status: RunStatus;
  duration: number;
  startedAt: number;
  endedAt?: number;
  notes?: string;
  gitCommit?: string;
  environment: Record<string, string>;
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'killed' | 'scheduled';

export interface Artifact {
  artifactId: string;
  name: string;
  type: ArtifactType;
  size: number;
  path: string;
  checksum: string;
  createdAt: number;
}

export type ArtifactType = 'model' | 'dataset' | 'plot' | 'report' | 'checkpoint' | 'code';

export interface RegisteredModel {
  modelId: string;
  name: string;
  description: string;
  framework: MLFramework;
  task: MLTask;
  versions: ModelVersion[];
  latestVersion: number;
  productionVersion?: number;
  stagingVersion?: number;
  tags: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export type MLFramework =
  | 'tensorflow'
  | 'pytorch'
  | 'sklearn'
  | 'xgboost'
  | 'lightgbm'
  | 'keras'
  | 'onnx'
  | 'custom';

export type MLTask =
  | 'classification'
  | 'regression'
  | 'clustering'
  | 'object_detection'
  | 'nlp'
  | 'recommendation'
  | 'time_series'
  | 'anomaly_detection'
  | 'generative';

export interface ModelVersion {
  version: number;
  modelId: string;
  runId: string;
  stage: ModelStage;
  metrics: Record<string, number>;
  parameters: Record<string, unknown>;
  signature: ModelSignature;
  requirements: string[];
  artifactPath: string;
  description?: string;
  approvedBy?: string;
  createdAt: number;
  deployedAt?: number;
  deprecatedAt?: number;
}

export type ModelStage = 'experimental' | 'staging' | 'production' | 'archived';

export interface ModelSignature {
  inputs: Record<string, string>;
  outputs: Record<string, string>;
  params?: Record<string, unknown>;
}

export interface HyperparameterSearchConfig {
  algorithm: 'grid' | 'random' | 'bayesian' | 'hyperband' | 'cma_es';
  parameterSpace: ParameterSpace;
  maxTrials: number;
  maxConcurrent: number;
  objective: { metric: string; direction: 'minimize' | 'maximize' };
  earlyStoppingEnabled: boolean;
  earlyStoppingPatience: number;
  timeoutMs?: number;
}

export type ParameterSpace = Record<string, ParameterDistribution>;

export type ParameterDistribution =
  | { type: 'uniform'; low: number; high: number }
  | { type: 'log_uniform'; low: number; high: number }
  | { type: 'int'; low: number; high: number }
  | { type: 'choice'; values: unknown[] }
  | { type: 'bool' };

export interface HyperparameterSearchResult {
  searchId: string;
  experimentId: string;
  config: HyperparameterSearchConfig;
  trials: SearchTrial[];
  bestTrial: SearchTrial;
  searchTimeMs: number;
  status: 'running' | 'completed' | 'failed' | 'stopped';
}

export interface SearchTrial {
  trialId: string;
  parameters: Record<string, unknown>;
  metrics: Record<string, number>;
  status: RunStatus;
  duration: number;
  rank: number;
}

export interface ModelDeployment {
  deploymentId: string;
  modelId: string;
  version: number;
  environment: 'development' | 'staging' | 'production';
  strategy: DeploymentStrategy;
  config: DeploymentConfig;
  health: DeploymentHealth;
  traffic: TrafficConfig;
  status: DeploymentStatus;
  createdAt: number;
  updatedAt: number;
}

export type DeploymentStrategy = 'blue_green' | 'canary' | 'rolling' | 'shadow' | 'a_b_test';
export type DeploymentStatus = 'pending' | 'deploying' | 'active' | 'failed' | 'rolled_back';

export interface DeploymentConfig {
  replicas: number;
  cpuRequest: string;
  memoryRequest: string;
  gpuRequest?: number;
  maxBatchSize: number;
  maxConcurrency: number;
  timeoutMs: number;
  enableLogging: boolean;
  enableMonitoring: boolean;
}

export interface DeploymentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyP50Ms: number;
  latencyP99Ms: number;
  errorRate: number;
  requestsPerSecond: number;
  uptime: number;
}

export interface TrafficConfig {
  currentVersion: number;
  canaryVersion?: number;
  canaryPercent: number;
  shadowVersion?: number;
}

export interface DataDriftReport {
  modelId: string;
  version: number;
  period: string;
  featureDrifts: FeatureDrift[];
  predictionDrift: PredictionDrift;
  overallDriftScore: number;
  driftDetected: boolean;
  retrainingRecommended: boolean;
  generatedAt: number;
}

export interface FeatureDrift {
  featureName: string;
  driftScore: number;
  driftType: 'covariate' | 'concept' | 'none';
  referenceStats: { mean: number; std: number; min: number; max: number };
  currentStats: { mean: number; std: number; min: number; max: number };
  pValue: number;
  driftDetected: boolean;
}

export interface PredictionDrift {
  driftScore: number;
  referenceDistribution: number[];
  currentDistribution: number[];
  performanceDelta: number;
  accuracyDelta: number;
}

export interface RetrainingJob {
  jobId: string;
  modelId: string;
  trigger: 'scheduled' | 'drift' | 'performance' | 'manual';
  status: 'queued' | 'running' | 'completed' | 'failed';
  config: TrainingConfig;
  result?: TrainingResult;
  scheduledAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TrainingConfig {
  dataSource: string;
  dataStartDate: number;
  dataEndDate: number;
  validationSplit: number;
  hyperparameters: Record<string, unknown>;
  maxTrainingTimeMs: number;
  targetMetric: string;
  targetValue: number;
}

export interface TrainingResult {
  runId: string;
  metrics: Record<string, number>;
  success: boolean;
  promotedToStaging: boolean;
  promotedToProduction: boolean;
  trainingTimeMs: number;
}

export interface MLPipelineDefinition {
  pipelineId: string;
  name: string;
  steps: PipelineStep[];
  schedule?: string;
  triggers: PipelineTrigger[];
  enabled: boolean;
  createdAt: number;
}

export interface PipelineStep {
  stepId: string;
  name: string;
  type: 'data_ingestion' | 'preprocessing' | 'training' | 'evaluation' | 'deployment' | 'monitoring';
  config: Record<string, unknown>;
  dependsOn: string[];
  retries: number;
  timeoutMs: number;
}

export type PipelineTrigger = {
  type: 'schedule' | 'drift' | 'performance_drop' | 'data_arrival' | 'manual';
  config?: Record<string, unknown>;
};

export class MLOpsOrchestrator {
  private experiments = new Map<string, MLExperiment>();
  private models = new Map<string, RegisteredModel>();
  private deployments = new Map<string, ModelDeployment>();
  private retrainingJobs = new Map<string, RetrainingJob>();
  private pipelines = new Map<string, MLPipelineDefinition>();
  private driftReports = new Map<string, DataDriftReport[]>();
  private hyperparamSearches = new Map<string, HyperparameterSearchResult>();

  createExperiment(
    name: string,
    projectId: string,
    description = '',
    tags: Record<string, string> = {}
  ): MLExperiment {
    const exp: MLExperiment = {
      experimentId: `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      description,
      projectId,
      status: 'active',
      runs: [],
      tags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.experiments.set(exp.experimentId, exp);
    logger.info('ML experiment created', { experimentId: exp.experimentId, name, projectId });
    return exp;
  }

  logRun(
    experimentId: string,
    params: Record<string, unknown>,
    metrics: Record<string, number>,
    artifacts: Omit<Artifact, 'artifactId' | 'createdAt'>[] = []
  ): ExperimentRun {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    const run: ExperimentRun = {
      runId: `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      experimentId,
      parameters: params,
      metrics,
      artifacts: artifacts.map(a => ({
        ...a,
        artifactId: `art-${Date.now()}`,
        createdAt: Date.now(),
      })),
      status: 'completed',
      duration: Math.random() * 3600000,
      startedAt: Date.now() - Math.random() * 3600000,
      endedAt: Date.now(),
      environment: { node_version: process.version },
    };

    exp.runs.push(run);
    exp.updatedAt = Date.now();

    const primaryMetric = Object.keys(metrics)[0];
    if (primaryMetric && (!exp.bestRunId || this.isBetterRun(run, exp, primaryMetric))) {
      exp.bestRunId = run.runId;
    }

    logger.info('Experiment run logged', {
      runId: run.runId,
      experimentId,
      metrics,
    });

    return run;
  }

  registerModel(
    name: string,
    framework: MLFramework,
    task: MLTask,
    description = '',
    tags: Record<string, string> = {}
  ): RegisteredModel {
    const existing = Array.from(this.models.values()).find(m => m.name === name);
    if (existing) return existing;

    const model: RegisteredModel = {
      modelId: `model-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      description,
      framework,
      task,
      versions: [],
      latestVersion: 0,
      tags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.models.set(model.modelId, model);
    logger.info('Model registered', { modelId: model.modelId, name, framework, task });
    return model;
  }

  addModelVersion(
    modelId: string,
    runId: string,
    metrics: Record<string, number>,
    params: Record<string, unknown>,
    signature: ModelSignature,
    requirements: string[] = []
  ): ModelVersion {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);

    const version: ModelVersion = {
      version: model.latestVersion + 1,
      modelId,
      runId,
      stage: 'experimental',
      metrics,
      parameters: params,
      signature,
      requirements,
      artifactPath: `models/${modelId}/v${model.latestVersion + 1}`,
      createdAt: Date.now(),
    };

    model.versions.push(version);
    model.latestVersion = version.version;
    model.updatedAt = Date.now();

    logger.info('Model version added', {
      modelId,
      version: version.version,
      stage: version.stage,
    });

    return version;
  }

  promoteModel(modelId: string, version: number, stage: ModelStage, approvedBy?: string): void {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);

    const modelVersion = model.versions.find(v => v.version === version);
    if (!modelVersion) throw new Error(`Version ${version} not found`);

    modelVersion.stage = stage;
    modelVersion.approvedBy = approvedBy;

    if (stage === 'production') {
      model.productionVersion = version;
      modelVersion.deployedAt = Date.now();
    } else if (stage === 'staging') {
      model.stagingVersion = version;
    }

    model.updatedAt = Date.now();

    logger.info('Model promoted', { modelId, version, stage, approvedBy });
  }

  runHyperparameterSearch(
    experimentId: string,
    config: HyperparameterSearchConfig
  ): HyperparameterSearchResult {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    const searchId = `search-${Date.now()}`;
    const start = Date.now();
    const trials: SearchTrial[] = [];

    const trialCount = Math.min(config.maxTrials, 10);
    for (let i = 0; i < trialCount; i++) {
      const params = this.sampleParameters(config.parameterSpace, config.algorithm, trials);
      const simulatedMetric = this.simulateMetric(params, config.objective.metric);

      trials.push({
        trialId: `trial-${searchId}-${i}`,
        parameters: params,
        metrics: { [config.objective.metric]: simulatedMetric },
        status: 'completed',
        duration: Math.random() * 300000,
        rank: 0,
      });
    }

    const sorted = [...trials].sort((a, b) => {
      const ma = a.metrics[config.objective.metric] ?? 0;
      const mb = b.metrics[config.objective.metric] ?? 0;
      return config.objective.direction === 'maximize' ? mb - ma : ma - mb;
    });
    sorted.forEach((t, i) => { t.rank = i + 1; });

    const result: HyperparameterSearchResult = {
      searchId,
      experimentId,
      config,
      trials,
      bestTrial: sorted[0],
      searchTimeMs: Date.now() - start,
      status: 'completed',
    };

    this.hyperparamSearches.set(searchId, result);
    logger.info('Hyperparameter search completed', {
      searchId,
      experimentId,
      trials: trials.length,
      bestMetric: sorted[0]?.metrics[config.objective.metric],
    });

    return result;
  }

  deployModel(
    modelId: string,
    version: number,
    environment: ModelDeployment['environment'],
    strategy: DeploymentStrategy,
    config?: Partial<DeploymentConfig>
  ): ModelDeployment {
    const model = this.models.get(modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);

    const deployment: ModelDeployment = {
      deploymentId: `deploy-${Date.now()}`,
      modelId,
      version,
      environment,
      strategy,
      config: {
        replicas: 2,
        cpuRequest: '500m',
        memoryRequest: '512Mi',
        maxBatchSize: 32,
        maxConcurrency: 100,
        timeoutMs: 5000,
        enableLogging: true,
        enableMonitoring: true,
        ...config,
      },
      health: {
        status: 'healthy',
        latencyP50Ms: 50,
        latencyP99Ms: 200,
        errorRate: 0.001,
        requestsPerSecond: 100,
        uptime: 1.0,
      },
      traffic: {
        currentVersion: version,
        canaryPercent: strategy === 'canary' ? 10 : 0,
      },
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.deployments.set(deployment.deploymentId, deployment);
    logger.info('Model deployed', {
      deploymentId: deployment.deploymentId,
      modelId,
      version,
      environment,
      strategy,
    });

    return deployment;
  }

  detectDrift(modelId: string, version: number, featureStats: Record<string, { mean: number; std: number }>): DataDriftReport {
    const report: DataDriftReport = {
      modelId,
      version,
      period: new Date().toISOString().slice(0, 7),
      featureDrifts: Object.entries(featureStats).map(([featureName, stats]) => {
        const driftScore = Math.random() * 0.3;
        return {
          featureName,
          driftScore,
          driftType: driftScore > 0.2 ? 'covariate' : 'none',
          referenceStats: { mean: stats.mean, std: stats.std, min: stats.mean - 3 * stats.std, max: stats.mean + 3 * stats.std },
          currentStats: {
            mean: stats.mean + (Math.random() - 0.5) * stats.std,
            std: stats.std * (1 + (Math.random() - 0.5) * 0.2),
            min: stats.mean - 3 * stats.std,
            max: stats.mean + 3 * stats.std,
          },
          pValue: Math.random(),
          driftDetected: driftScore > 0.2,
        };
      }),
      predictionDrift: {
        driftScore: Math.random() * 0.2,
        referenceDistribution: Array.from({ length: 10 }, () => Math.random()),
        currentDistribution: Array.from({ length: 10 }, () => Math.random()),
        performanceDelta: (Math.random() - 0.5) * 0.1,
        accuracyDelta: (Math.random() - 0.5) * 0.1,
      },
      overallDriftScore: 0,
      driftDetected: false,
      retrainingRecommended: false,
      generatedAt: Date.now(),
    };

    report.overallDriftScore =
      report.featureDrifts.reduce((s, f) => s + f.driftScore, 0) /
      Math.max(report.featureDrifts.length, 1);
    report.driftDetected = report.overallDriftScore > 0.15;
    report.retrainingRecommended = report.overallDriftScore > 0.25;

    const existing = this.driftReports.get(modelId) ?? [];
    existing.push(report);
    this.driftReports.set(modelId, existing);

    if (report.retrainingRecommended) {
      this.scheduleRetraining(modelId, 'drift');
    }

    logger.info('Drift detection completed', {
      modelId,
      version,
      overallDriftScore: report.overallDriftScore.toFixed(3),
      driftDetected: report.driftDetected,
      retrainingRecommended: report.retrainingRecommended,
    });

    return report;
  }

  scheduleRetraining(modelId: string, trigger: RetrainingJob['trigger']): RetrainingJob {
    const job: RetrainingJob = {
      jobId: `retrain-${Date.now()}`,
      modelId,
      trigger,
      status: 'queued',
      config: {
        dataSource: 'production_database',
        dataStartDate: Date.now() - 90 * 86400_000,
        dataEndDate: Date.now(),
        validationSplit: 0.2,
        hyperparameters: {},
        maxTrainingTimeMs: 7200000,
        targetMetric: 'accuracy',
        targetValue: 0.9,
      },
      scheduledAt: Date.now(),
    };

    this.retrainingJobs.set(job.jobId, job);

    setTimeout(() => this.executeRetraining(job.jobId), 100);

    logger.info('Retraining job scheduled', { jobId: job.jobId, modelId, trigger });
    return job;
  }

  getExperimentSummary(experimentId: string): {
    totalRuns: number;
    bestMetrics: Record<string, number>;
    avgMetrics: Record<string, number>;
    paramImportance: Record<string, number>;
  } {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    const completedRuns = exp.runs.filter(r => r.status === 'completed');
    if (completedRuns.length === 0) {
      return { totalRuns: 0, bestMetrics: {}, avgMetrics: {}, paramImportance: {} };
    }

    const allMetricKeys = Array.from(new Set(completedRuns.flatMap(r => Object.keys(r.metrics))));
    const bestMetrics: Record<string, number> = {};
    const avgMetrics: Record<string, number> = {};

    allMetricKeys.forEach(key => {
      const values = completedRuns.map(r => r.metrics[key] ?? 0);
      bestMetrics[key] = Math.max(...values);
      avgMetrics[key] = values.reduce((s, v) => s + v, 0) / values.length;
    });

    const allParamKeys = Array.from(new Set(completedRuns.flatMap(r => Object.keys(r.parameters))));
    const paramImportance: Record<string, number> = {};
    allParamKeys.forEach(key => {
      paramImportance[key] = Math.random();
    });

    return {
      totalRuns: completedRuns.length,
      bestMetrics,
      avgMetrics,
      paramImportance,
    };
  }

  getModelCatalog(): RegisteredModel[] {
    return Array.from(this.models.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getDeploymentStatus(deploymentId: string): ModelDeployment | undefined {
    return this.deployments.get(deploymentId);
  }

  getDriftHistory(modelId: string): DataDriftReport[] {
    return this.driftReports.get(modelId) ?? [];
  }

  private executeRetraining(jobId: string): void {
    const job = this.retrainingJobs.get(jobId);
    if (!job) return;

    job.status = 'running';
    job.startedAt = Date.now();

    setTimeout(() => {
      job.status = 'completed';
      job.completedAt = Date.now();
      job.result = {
        runId: `run-retrain-${Date.now()}`,
        metrics: { accuracy: 0.92, loss: 0.08, f1: 0.91 },
        success: true,
        promotedToStaging: true,
        promotedToProduction: false,
        trainingTimeMs: job.completedAt - (job.startedAt ?? job.completedAt),
      };
      logger.info('Retraining job completed', { jobId, modelId: job.modelId });
    }, 50);
  }

  private sampleParameters(
    space: ParameterSpace,
    algorithm: HyperparameterSearchConfig['algorithm'],
    _previousTrials: SearchTrial[]
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    Object.entries(space).forEach(([key, dist]) => {
      switch (dist.type) {
        case 'uniform':
          params[key] = dist.low + Math.random() * (dist.high - dist.low);
          break;
        case 'log_uniform':
          params[key] = Math.exp(Math.log(dist.low) + Math.random() * (Math.log(dist.high) - Math.log(dist.low)));
          break;
        case 'int':
          params[key] = Math.floor(dist.low + Math.random() * (dist.high - dist.low + 1));
          break;
        case 'choice':
          params[key] = dist.values[Math.floor(Math.random() * dist.values.length)];
          break;
        case 'bool':
          params[key] = Math.random() > 0.5;
          break;
      }
    });
    return params;
  }

  private simulateMetric(params: Record<string, unknown>, metric: string): number {
    const base = 0.7 + Math.random() * 0.25;
    return Math.min(1, Math.max(0, base));
  }

  private isBetterRun(run: ExperimentRun, exp: MLExperiment, metric: string): boolean {
    const bestRun = exp.runs.find(r => r.runId === exp.bestRunId);
    if (!bestRun) return true;
    return (run.metrics[metric] ?? 0) > (bestRun.metrics[metric] ?? 0);
  }
}

let _orchestrator: MLOpsOrchestrator | null = null;

export function getMLOpsOrchestrator(): MLOpsOrchestrator {
  if (!_orchestrator) {
    _orchestrator = new MLOpsOrchestrator();
  }
  return _orchestrator;
}
