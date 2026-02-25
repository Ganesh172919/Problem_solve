/**
 * AI Model Version Manager
 *
 * Complete AI model lifecycle management:
 * - Model registration with version, architecture, hyperparameters metadata
 * - Semantic versioning for models (major.minor.patch)
 * - Model promotion pipeline (staging → canary → production → archived)
 * - A/B testing between model versions with traffic splitting
 * - Performance tracking per version (latency, accuracy, cost, token usage)
 * - Automatic rollback on performance degradation
 * - Model comparison and benchmarking
 * - Canary deployment with gradual traffic shift
 * - Model lineage tracking (parent model, fine-tuning history)
 * - Model health monitoring with SLO enforcement
 * - Cost tracking per model version
 * - Feature compatibility matrix
 * - Model deprecation workflow
 * - Inference routing based on model capabilities
 * - Shadow testing (run new model in parallel without affecting production)
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export type ModelStage = 'staging' | 'canary' | 'production' | 'archived';
export type DeprecationPhase = 'active' | 'deprecated' | 'sunset' | 'removed';
export type CapabilityTag = 'text-generation' | 'summarization' | 'classification' | 'embedding'
  | 'code-generation' | 'translation' | 'qa' | 'chat' | 'image-generation' | 'custom';
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface SemanticVersion { major: number; minor: number; patch: number; }

export interface HyperParameters {
  learningRate?: number; batchSize?: number; epochs?: number;
  maxTokens?: number; temperature?: number; topP?: number;
  [key: string]: unknown;
}

export interface ModelLineage {
  parentModelId: string | null;
  fineTuningHistory: Array<{ baseModel: string; dataset: string; timestamp: number; metrics: Record<string, number> }>;
  trainingDataHash: string | null;
}

export interface ModelMetadata {
  architecture: string; framework: string; hyperParameters: HyperParameters;
  capabilities: CapabilityTag[]; inputFormat: string; outputFormat: string;
  maxContextLength: number; parameterCount?: number; quantization?: string;
}

export interface PerformanceMetrics {
  latencyP50Ms: number; latencyP95Ms: number; latencyP99Ms: number;
  accuracyScore: number; costPerRequest: number; tokenUsageAvg: number;
  requestCount: number; errorRate: number; throughputRps: number; lastUpdated: number;
}

export interface SLODefinition {
  latencyP95MaxMs: number; latencyP99MaxMs: number; minAccuracy: number;
  maxErrorRate: number; maxCostPerRequest: number; minThroughputRps: number;
}

export interface ABTestConfig {
  testId: string; controlVersionId: string; treatmentVersionId: string;
  trafficSplitPercent: number; startTime: number; endTime: number | null;
  minSampleSize: number; significanceLevel: number;
}

export interface ABTestResult {
  testId: string; controlMetrics: PerformanceMetrics; treatmentMetrics: PerformanceMetrics;
  sampleSizeControl: number; sampleSizeTreatment: number;
  latencyImprovement: number; accuracyImprovement: number; costDifference: number;
  isSignificant: boolean; winner: 'control' | 'treatment' | 'inconclusive';
}

export interface CanaryDeployment {
  deploymentId: string; canaryVersionId: string; productionVersionId: string;
  currentTrafficPercent: number; targetTrafficPercent: number;
  stepPercent: number; stepIntervalMs: number;
  startTime: number; lastStepTime: number;
  status: 'in_progress' | 'completed' | 'rolled_back' | 'paused';
  healthChecks: Array<{ timestamp: number; healthy: boolean; metrics: Partial<PerformanceMetrics> }>;
}

export interface ShadowTest {
  testId: string; shadowVersionId: string; productionVersionId: string;
  startTime: number; endTime: number | null;
  requestsCaptured: number; divergenceRate: number; shadowMetrics: PerformanceMetrics;
}

export interface FeatureCompatibility {
  feature: string; supportedVersions: string[]; minVersion: string; maxVersion?: string;
}

export interface ModelVersion {
  id: string; name: string; version: SemanticVersion;
  stage: ModelStage; deprecation: DeprecationPhase;
  metadata: ModelMetadata; lineage: ModelLineage;
  performance: PerformanceMetrics; slo: SLODefinition;
  registeredAt: number; promotedAt: number | null; deprecatedAt: number | null;
  tags: Record<string, string>;
}

function vstr(v: SemanticVersion): string { return `${v.major}.${v.minor}.${v.patch}`; }

function parseVersion(s: string): SemanticVersion {
  const p = s.split('.').map(Number);
  if (p.length !== 3 || p.some(isNaN)) throw new Error(`Invalid semantic version: ${s}`);
  return { major: p[0], minor: p[1], patch: p[2] };
}

function cmpVer(a: SemanticVersion, b: SemanticVersion): number {
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

function zeroMetrics(): PerformanceMetrics {
  return { latencyP50Ms: 0, latencyP95Ms: 0, latencyP99Ms: 0, accuracyScore: 0,
    costPerRequest: 0, tokenUsageAvg: 0, requestCount: 0, errorRate: 0,
    throughputRps: 0, lastUpdated: Date.now() };
}

function defaultSLO(): SLODefinition {
  return { latencyP95MaxMs: 500, latencyP99MaxMs: 1000, minAccuracy: 0.85,
    maxErrorRate: 0.05, maxCostPerRequest: 0.05, minThroughputRps: 10 };
}

const STAGE_ORDER: ModelStage[] = ['staging', 'canary', 'production', 'archived'];

export class AIModelVersionManager {
  private models = new Map<string, ModelVersion>();
  private abTests = new Map<string, ABTestConfig>();
  private abResults = new Map<string, ABTestResult>();
  private canaryDeployments = new Map<string, CanaryDeployment>();
  private shadowTests = new Map<string, ShadowTest>();
  private featureMatrix: FeatureCompatibility[] = [];
  private costLedger = new Map<string, Array<{ timestamp: number; cost: number; requests: number }>>();
  private rollbackHistory: Array<{ from: string; to: string; reason: string; timestamp: number }> = [];

  registerModel(name: string, version: string, metadata: ModelMetadata,
    lineage?: Partial<ModelLineage>, slo?: Partial<SLODefinition>, tags?: Record<string, string>): ModelVersion {
    const semver = parseVersion(version);
    const id = `${name}@${version}`;
    if (this.models.has(id)) throw new Error(`Model ${id} is already registered`);

    const model: ModelVersion = {
      id, name, version: semver, stage: 'staging', deprecation: 'active', metadata,
      lineage: { parentModelId: lineage?.parentModelId ?? null,
        fineTuningHistory: lineage?.fineTuningHistory ?? [],
        trainingDataHash: lineage?.trainingDataHash ?? null },
      performance: zeroMetrics(), slo: { ...defaultSLO(), ...slo },
      registeredAt: Date.now(), promotedAt: null, deprecatedAt: null, tags: tags ?? {},
    };

    this.models.set(id, model);
    this.costLedger.set(id, []);
    logger.info(`Model registered: ${id}`, { architecture: metadata.architecture, capabilities: metadata.capabilities });
    return model;
  }

  getModel(id: string): ModelVersion | undefined { return this.models.get(id); }

  listModels(filter?: { name?: string; stage?: ModelStage; capability?: CapabilityTag }): ModelVersion[] {
    let r = Array.from(this.models.values());
    if (filter?.name) r = r.filter(m => m.name === filter.name);
    if (filter?.stage) r = r.filter(m => m.stage === filter.stage);
    if (filter?.capability) r = r.filter(m => m.metadata.capabilities.includes(filter.capability!));
    return r;
  }

  getNextVersion(name: string, bump: 'major' | 'minor' | 'patch'): string {
    const vers = Array.from(this.models.values()).filter(m => m.name === name)
      .map(m => m.version).sort(cmpVer);
    if (!vers.length) return '1.0.0';
    const latest = { ...vers[vers.length - 1] };
    if (bump === 'major') { latest.major++; latest.minor = 0; latest.patch = 0; }
    else if (bump === 'minor') { latest.minor++; latest.patch = 0; }
    else latest.patch++;
    return vstr(latest);
  }

  getLatestVersion(name: string, stage?: ModelStage): ModelVersion | undefined {
    return Array.from(this.models.values())
      .filter(m => m.name === name && m.deprecation !== 'removed' && (!stage || m.stage === stage))
      .sort((a, b) => cmpVer(b.version, a.version))[0];
  }

  // --- Promotion Pipeline ---

  promoteModel(id: string, targetStage?: ModelStage): ModelVersion {
    const model = this.models.get(id);
    if (!model) throw new Error(`Model ${id} not found`);
    if (model.deprecation !== 'active') throw new Error(`Cannot promote deprecated model ${id}`);

    const curIdx = STAGE_ORDER.indexOf(model.stage);
    const next = targetStage ?? STAGE_ORDER[curIdx + 1];
    if (!next) throw new Error(`Model ${id} is already at final stage`);
    const tgtIdx = STAGE_ORDER.indexOf(next);
    if (tgtIdx <= curIdx) throw new Error(`Cannot demote from ${model.stage} to ${next}`);

    if (next === 'production') {
      const violations = this.checkSLOViolations(model);
      if (violations.length > 0 && model.performance.requestCount > 0) {
        throw new Error(`Cannot promote to production: SLO violations: ${violations.join(', ')}`);
      }
    }

    const prev = model.stage;
    model.stage = next;
    model.promotedAt = Date.now();
    logger.info(`Model promoted: ${id}`, { from: prev, to: next });
    return model;
  }

  archiveModel(id: string): ModelVersion {
    const model = this.models.get(id);
    if (!model) throw new Error(`Model ${id} not found`);
    model.stage = 'archived';
    logger.info(`Model archived: ${id}`);
    return model;
  }

  // --- Performance Tracking ---

  recordInference(id: string, latencyMs: number, tokensUsed: number, cost: number,
    success: boolean, accuracy?: number): void {
    const model = this.models.get(id);
    if (!model) throw new Error(`Model ${id} not found`);

    const p = model.performance;
    const w = 1 / (p.requestCount + 1);
    p.latencyP50Ms = p.latencyP50Ms * (1 - w) + latencyMs * w;
    p.latencyP95Ms = Math.max(p.latencyP95Ms * (1 - w) + latencyMs * w, p.latencyP50Ms);
    p.latencyP99Ms = Math.max(p.latencyP99Ms * (1 - w) + latencyMs * w, p.latencyP95Ms);
    p.tokenUsageAvg = p.tokenUsageAvg * (1 - w) + tokensUsed * w;
    p.costPerRequest = p.costPerRequest * (1 - w) + cost * w;
    p.errorRate = p.errorRate * (1 - w) + (success ? 0 : 1) * w;
    if (accuracy !== undefined) p.accuracyScore = p.accuracyScore * (1 - w) + accuracy * w;
    p.requestCount++;
    p.lastUpdated = Date.now();

    const elapsed = (Date.now() - model.registeredAt) / 1000;
    p.throughputRps = elapsed > 0 ? p.requestCount / elapsed : 0;

    this.costLedger.get(id)?.push({ timestamp: Date.now(), cost, requests: 1 });
  }

  getPerformance(id: string): PerformanceMetrics | undefined { return this.models.get(id)?.performance; }

  // --- SLO & Health ---

  private checkSLOViolations(model: ModelVersion): string[] {
    const v: string[] = [];
    const { performance: p, slo: s } = model;
    if (p.latencyP95Ms > s.latencyP95MaxMs) v.push(`latencyP95 ${p.latencyP95Ms.toFixed(1)}ms > ${s.latencyP95MaxMs}ms`);
    if (p.latencyP99Ms > s.latencyP99MaxMs) v.push(`latencyP99 ${p.latencyP99Ms.toFixed(1)}ms > ${s.latencyP99MaxMs}ms`);
    if (p.accuracyScore < s.minAccuracy && p.requestCount > 0) v.push(`accuracy ${p.accuracyScore.toFixed(3)} < ${s.minAccuracy}`);
    if (p.errorRate > s.maxErrorRate) v.push(`errorRate ${p.errorRate.toFixed(3)} > ${s.maxErrorRate}`);
    if (p.costPerRequest > s.maxCostPerRequest) v.push(`cost $${p.costPerRequest.toFixed(4)} > $${s.maxCostPerRequest}`);
    if (p.throughputRps < s.minThroughputRps && p.requestCount > 100) v.push(`throughput ${p.throughputRps.toFixed(1)}rps < ${s.minThroughputRps}rps`);
    return v;
  }

  checkModelHealth(id: string): { status: HealthStatus; violations: string[] } {
    const model = this.models.get(id);
    if (!model) return { status: 'unknown', violations: ['Model not found'] };
    if (model.performance.requestCount === 0) return { status: 'unknown', violations: [] };
    const violations = this.checkSLOViolations(model);
    const status: HealthStatus = violations.length >= 3 ? 'unhealthy' : violations.length >= 1 ? 'degraded' : 'healthy';
    if (status !== 'healthy') logger.warn(`Model ${id} is ${status}`, { violations });
    return { status, violations };
  }

  monitorAllModels(): Array<{ id: string; status: HealthStatus; violations: string[] }> {
    return Array.from(this.models.values())
      .filter(m => m.stage !== 'archived' && m.deprecation !== 'removed')
      .map(m => ({ id: m.id, ...this.checkModelHealth(m.id) }));
  }

  // --- Automatic Rollback ---

  autoRollbackIfDegraded(id: string): { rolledBack: boolean; newActiveId?: string; reason?: string } {
    const model = this.models.get(id);
    if (!model || model.stage !== 'production') return { rolledBack: false };
    const health = this.checkModelHealth(id);
    if (health.status !== 'unhealthy') return { rolledBack: false };

    const fallback = Array.from(this.models.values())
      .filter(m => m.name === model.name && m.id !== id && m.deprecation === 'active'
        && (m.stage === 'archived' || m.stage === 'staging'))
      .sort((a, b) => cmpVer(b.version, a.version))[0];

    if (!fallback) {
      logger.error(`No rollback candidate for ${id}`);
      return { rolledBack: false, reason: 'No fallback version available' };
    }

    const reason = `SLO violations: ${health.violations.join('; ')}`;
    model.stage = 'archived';
    fallback.stage = 'production';
    fallback.promotedAt = Date.now();
    this.rollbackHistory.push({ from: id, to: fallback.id, reason, timestamp: Date.now() });
    logger.info(`Auto-rollback: ${id} → ${fallback.id}`, { reason });
    return { rolledBack: true, newActiveId: fallback.id, reason };
  }

  getRollbackHistory() { return [...this.rollbackHistory]; }

  // --- A/B Testing ---

  createABTest(controlId: string, treatmentId: string, trafficSplitPercent: number,
    config?: { minSampleSize?: number; significanceLevel?: number; durationMs?: number }): ABTestConfig {
    if (!this.models.has(controlId)) throw new Error(`Control model ${controlId} not found`);
    if (!this.models.has(treatmentId)) throw new Error(`Treatment model ${treatmentId} not found`);
    if (trafficSplitPercent < 1 || trafficSplitPercent > 99) throw new Error('Traffic split must be 1-99%');

    const test: ABTestConfig = {
      testId: genId('ab'), controlVersionId: controlId, treatmentVersionId: treatmentId,
      trafficSplitPercent, startTime: Date.now(),
      endTime: config?.durationMs ? Date.now() + config.durationMs : null,
      minSampleSize: config?.minSampleSize ?? 1000, significanceLevel: config?.significanceLevel ?? 0.05,
    };
    this.abTests.set(test.testId, test);
    logger.info(`A/B test created: ${test.testId}`, { controlId, treatmentId, trafficSplitPercent });
    return test;
  }

  routeABTestRequest(testId: string): string {
    const test = this.abTests.get(testId);
    if (!test) throw new Error(`A/B test ${testId} not found`);
    if (test.endTime && Date.now() > test.endTime) throw new Error(`A/B test ${testId} has expired`);
    return Math.random() * 100 < test.trafficSplitPercent ? test.treatmentVersionId : test.controlVersionId;
  }

  evaluateABTest(testId: string): ABTestResult {
    const test = this.abTests.get(testId);
    if (!test) throw new Error(`A/B test ${testId} not found`);
    const control = this.models.get(test.controlVersionId);
    const treatment = this.models.get(test.treatmentVersionId);
    if (!control || !treatment) throw new Error('A/B test models missing');

    const cp = control.performance, tp = treatment.performance;
    const latImp = cp.latencyP50Ms > 0 ? (cp.latencyP50Ms - tp.latencyP50Ms) / cp.latencyP50Ms : 0;
    const accImp = cp.accuracyScore > 0 ? (tp.accuracyScore - cp.accuracyScore) / cp.accuracyScore : 0;
    const costDiff = cp.costPerRequest > 0 ? (tp.costPerRequest - cp.costPerRequest) / cp.costPerRequest : 0;
    const isSig = cp.requestCount >= test.minSampleSize && tp.requestCount >= test.minSampleSize;

    let winner: 'control' | 'treatment' | 'inconclusive' = 'inconclusive';
    if (isSig) {
      if (accImp > 0 && latImp >= -0.1 && costDiff <= 0.2) winner = 'treatment';
      else if (accImp < 0 || (latImp < -0.2 && accImp <= 0)) winner = 'control';
    }

    const result: ABTestResult = {
      testId, controlMetrics: { ...cp }, treatmentMetrics: { ...tp },
      sampleSizeControl: cp.requestCount, sampleSizeTreatment: tp.requestCount,
      latencyImprovement: latImp, accuracyImprovement: accImp, costDifference: costDiff,
      isSignificant: isSig, winner,
    };
    this.abResults.set(testId, result);
    logger.info(`A/B test evaluated: ${testId}`, { winner, isSignificant: isSig });
    return result;
  }

  concludeABTest(testId: string, promoteWinner: boolean): ABTestResult {
    const result = this.abResults.get(testId) ?? this.evaluateABTest(testId);
    this.abTests.get(testId)!.endTime = Date.now();
    if (promoteWinner && result.winner !== 'inconclusive') {
      const winnerId = result.winner === 'treatment' ? this.abTests.get(testId)!.treatmentVersionId : this.abTests.get(testId)!.controlVersionId;
      const loserId = result.winner === 'treatment' ? this.abTests.get(testId)!.controlVersionId : this.abTests.get(testId)!.treatmentVersionId;
      const w = this.models.get(winnerId), l = this.models.get(loserId);
      if (w && w.stage !== 'production') { w.stage = 'production'; w.promotedAt = Date.now(); }
      if (l && l.stage === 'production') l.stage = 'archived';
      logger.info(`A/B concluded: promoted ${winnerId}, archived ${loserId}`);
    }
    return result;
  }

  // --- Canary Deployment ---

  startCanaryDeployment(canaryId: string, productionId: string,
    config?: { targetPercent?: number; stepPercent?: number; stepIntervalMs?: number }): CanaryDeployment {
    if (!this.models.has(canaryId)) throw new Error(`Canary model ${canaryId} not found`);
    if (!this.models.has(productionId)) throw new Error(`Production model ${productionId} not found`);

    const dep: CanaryDeployment = {
      deploymentId: genId('canary'), canaryVersionId: canaryId, productionVersionId: productionId,
      currentTrafficPercent: 0, targetTrafficPercent: config?.targetPercent ?? 100,
      stepPercent: config?.stepPercent ?? 10, stepIntervalMs: config?.stepIntervalMs ?? 60000,
      startTime: Date.now(), lastStepTime: Date.now(), status: 'in_progress', healthChecks: [],
    };
    this.canaryDeployments.set(dep.deploymentId, dep);
    this.models.get(canaryId)!.stage = 'canary';
    logger.info(`Canary started: ${dep.deploymentId}`, { canaryId, productionId });
    return dep;
  }

  advanceCanary(deploymentId: string): CanaryDeployment {
    const dep = this.canaryDeployments.get(deploymentId);
    if (!dep) throw new Error(`Canary deployment ${deploymentId} not found`);
    if (dep.status !== 'in_progress') throw new Error(`Canary ${deploymentId} is ${dep.status}`);

    const health = this.checkModelHealth(dep.canaryVersionId);
    dep.healthChecks.push({
      timestamp: Date.now(), healthy: health.status !== 'unhealthy',
      metrics: { ...this.models.get(dep.canaryVersionId)?.performance } as Partial<PerformanceMetrics>,
    });

    if (health.status === 'unhealthy') {
      dep.status = 'rolled_back'; dep.currentTrafficPercent = 0;
      const cm = this.models.get(dep.canaryVersionId);
      if (cm) cm.stage = 'staging';
      logger.warn(`Canary rolled back: ${deploymentId}`, { violations: health.violations });
      return dep;
    }

    dep.currentTrafficPercent = Math.min(dep.currentTrafficPercent + dep.stepPercent, dep.targetTrafficPercent);
    dep.lastStepTime = Date.now();

    if (dep.currentTrafficPercent >= dep.targetTrafficPercent) {
      dep.status = 'completed';
      const cm = this.models.get(dep.canaryVersionId)!;
      cm.stage = 'production'; cm.promotedAt = Date.now();
      const pm = this.models.get(dep.productionVersionId);
      if (pm) pm.stage = 'archived';
      logger.info(`Canary completed: ${deploymentId}, promoted ${dep.canaryVersionId}`);
    }
    return dep;
  }

  routeCanaryRequest(deploymentId: string): string {
    const dep = this.canaryDeployments.get(deploymentId);
    if (!dep || dep.status !== 'in_progress') throw new Error(`No active canary ${deploymentId}`);
    return Math.random() * 100 < dep.currentTrafficPercent ? dep.canaryVersionId : dep.productionVersionId;
  }

  // --- Shadow Testing ---

  startShadowTest(shadowId: string, productionId: string): ShadowTest {
    if (!this.models.has(shadowId)) throw new Error(`Shadow model ${shadowId} not found`);
    if (!this.models.has(productionId)) throw new Error(`Production model ${productionId} not found`);
    const test: ShadowTest = {
      testId: genId('shadow'), shadowVersionId: shadowId, productionVersionId: productionId,
      startTime: Date.now(), endTime: null, requestsCaptured: 0, divergenceRate: 0, shadowMetrics: zeroMetrics(),
    };
    this.shadowTests.set(test.testId, test);
    logger.info(`Shadow test started: ${test.testId}`, { shadowId, productionId });
    return test;
  }

  recordShadowResult(testId: string, prodOutput: string, shadowOutput: string,
    shadowLatencyMs: number, shadowTokens: number, shadowCost: number): void {
    const test = this.shadowTests.get(testId);
    if (!test) throw new Error(`Shadow test ${testId} not found`);
    test.requestsCaptured++;
    const n = test.requestsCaptured;
    const w = 1 / n;
    test.divergenceRate = test.divergenceRate * (1 - w) + (prodOutput !== shadowOutput ? 1 : 0) * w;
    const sm = test.shadowMetrics;
    sm.latencyP50Ms = sm.latencyP50Ms * (1 - w) + shadowLatencyMs * w;
    sm.latencyP95Ms = Math.max(sm.latencyP95Ms * (1 - w) + shadowLatencyMs * w, sm.latencyP50Ms);
    sm.tokenUsageAvg = sm.tokenUsageAvg * (1 - w) + shadowTokens * w;
    sm.costPerRequest = sm.costPerRequest * (1 - w) + shadowCost * w;
    sm.requestCount = n; sm.lastUpdated = Date.now();
  }

  endShadowTest(testId: string): ShadowTest {
    const test = this.shadowTests.get(testId);
    if (!test) throw new Error(`Shadow test ${testId} not found`);
    test.endTime = Date.now();
    logger.info(`Shadow test ended: ${testId}`, { requests: test.requestsCaptured, divergence: `${(test.divergenceRate * 100).toFixed(1)}%` });
    return test;
  }

  // --- Model Comparison & Benchmarking ---

  compareModels(idA: string, idB: string): {
    modelA: string; modelB: string; latencyDiff: number; accuracyDiff: number;
    costDiff: number; tokenDiff: number; errorRateDiff: number; recommendation: string;
  } {
    const a = this.models.get(idA), b = this.models.get(idB);
    if (!a || !b) throw new Error('One or both models not found');
    const pa = a.performance, pb = b.performance;
    const ld = pa.latencyP50Ms - pb.latencyP50Ms, ad = pa.accuracyScore - pb.accuracyScore;
    const cd = pa.costPerRequest - pb.costPerRequest, ed = pa.errorRate - pb.errorRate;
    const score = (ad > 0 ? 1 : -1) + (ld < 0 ? 1 : -1) + (cd < 0 ? 1 : -1) + (ed < 0 ? 1 : -1);
    const rec = score >= 2 ? `${idA} recommended` : score <= -2 ? `${idB} recommended` : 'Models perform similarly';
    return { modelA: idA, modelB: idB, latencyDiff: ld, accuracyDiff: ad, costDiff: cd,
      tokenDiff: pa.tokenUsageAvg - pb.tokenUsageAvg, errorRateDiff: ed, recommendation: rec };
  }

  benchmarkModel(id: string): { id: string; rank: number; totalModels: number; percentileBetter: number; sloCompliant: boolean } {
    const model = this.models.get(id);
    if (!model) throw new Error(`Model ${id} not found`);
    const peers = Array.from(this.models.values())
      .filter(m => m.name === model.name && m.deprecation !== 'removed' && m.performance.requestCount > 0)
      .sort((a, b) => {
        const sa = a.performance.accuracyScore - a.performance.latencyP50Ms / 1000 - a.performance.costPerRequest * 10;
        const sb = b.performance.accuracyScore - b.performance.latencyP50Ms / 1000 - b.performance.costPerRequest * 10;
        return sb - sa;
      });
    const rank = (peers.findIndex(m => m.id === id) + 1) || peers.length;
    return { id, rank, totalModels: peers.length,
      percentileBetter: peers.length > 1 ? ((peers.length - rank) / (peers.length - 1)) * 100 : 100,
      sloCompliant: this.checkSLOViolations(model).length === 0 };
  }

  // --- Cost Tracking ---

  getCostSummary(id: string, windowMs?: number): {
    totalCost: number; totalRequests: number; avgCostPerRequest: number; costTrend: 'increasing' | 'stable' | 'decreasing';
  } {
    const ledger = this.costLedger.get(id);
    if (!ledger?.length) return { totalCost: 0, totalRequests: 0, avgCostPerRequest: 0, costTrend: 'stable' };
    const entries = windowMs ? ledger.filter(e => e.timestamp >= Date.now() - windowMs) : ledger;
    const totalCost = entries.reduce((s, e) => s + e.cost, 0);
    const totalRequests = entries.reduce((s, e) => s + e.requests, 0);
    const mid = Math.floor(entries.length / 2);
    const firstAvg = entries.slice(0, mid).reduce((s, e) => s + e.cost, 0) / Math.max(mid, 1);
    const secondAvg = entries.slice(mid).reduce((s, e) => s + e.cost, 0) / Math.max(entries.length - mid, 1);
    const costTrend = secondAvg > firstAvg * 1.1 ? 'increasing' : secondAvg < firstAvg * 0.9 ? 'decreasing' : 'stable';
    return { totalCost, totalRequests, avgCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0, costTrend };
  }

  // --- Feature Compatibility Matrix ---

  registerFeatureCompatibility(feature: string, versionIds: string[], minVersion: string, maxVersion?: string): void {
    const existing = this.featureMatrix.find(f => f.feature === feature);
    if (existing) { existing.supportedVersions = versionIds; existing.minVersion = minVersion; existing.maxVersion = maxVersion; }
    else this.featureMatrix.push({ feature, supportedVersions: versionIds, minVersion, maxVersion });
    logger.debug(`Feature compatibility registered: ${feature}`, { versions: versionIds.length });
  }

  getCompatibleModels(feature: string): ModelVersion[] {
    const entry = this.featureMatrix.find(f => f.feature === feature);
    return entry ? entry.supportedVersions.map(id => this.models.get(id)).filter((m): m is ModelVersion => !!m && m.deprecation !== 'removed') : [];
  }

  getModelFeatures(id: string): string[] {
    return this.featureMatrix.filter(f => f.supportedVersions.includes(id)).map(f => f.feature);
  }

  // --- Deprecation Workflow ---

  deprecateModel(id: string, sunsetDate?: number): ModelVersion {
    const model = this.models.get(id);
    if (!model) throw new Error(`Model ${id} not found`);
    if (model.deprecation !== 'active') throw new Error(`Model ${id} is already ${model.deprecation}`);
    model.deprecation = 'deprecated'; model.deprecatedAt = Date.now();
    model.tags['sunsetDate'] = sunsetDate ? new Date(sunsetDate).toISOString() : 'TBD';
    logger.info(`Model deprecated: ${id}`, { sunsetDate: model.tags['sunsetDate'] });
    return model;
  }

  sunsetModel(id: string): ModelVersion {
    const model = this.models.get(id);
    if (!model) throw new Error(`Model ${id} not found`);
    if (model.deprecation !== 'deprecated') throw new Error(`Model ${id} must be deprecated before sunset`);
    model.deprecation = 'sunset'; model.stage = 'archived';
    logger.info(`Model sunset: ${id}`);
    return model;
  }

  removeModel(id: string): void {
    const model = this.models.get(id);
    if (!model) throw new Error(`Model ${id} not found`);
    if (model.deprecation !== 'sunset' && model.deprecation !== 'deprecated')
      throw new Error(`Model ${id} must be deprecated/sunset before removal`);
    model.deprecation = 'removed';
    for (const entry of this.featureMatrix) entry.supportedVersions = entry.supportedVersions.filter(v => v !== id);
    logger.info(`Model removed: ${id}`);
  }

  getDeprecationSchedule(): Array<{ id: string; phase: DeprecationPhase; sunsetDate: string | null; daysRemaining: number | null }> {
    return Array.from(this.models.values())
      .filter(m => m.deprecation !== 'active' && m.deprecation !== 'removed')
      .map(m => {
        const sd = m.tags['sunsetDate'] ?? null;
        const days = sd && sd !== 'TBD' ? Math.max(0, Math.ceil((new Date(sd).getTime() - Date.now()) / 86400000)) : null;
        return { id: m.id, phase: m.deprecation, sunsetDate: sd, daysRemaining: days };
      });
  }

  // --- Inference Routing ---

  routeByCapability(capability: CapabilityTag, preferStage?: ModelStage): string | null {
    const c = Array.from(this.models.values())
      .filter(m => m.metadata.capabilities.includes(capability) && m.deprecation === 'active'
        && m.stage === (preferStage ?? 'production'))
      .sort((a, b) => {
        const sa = a.performance.accuracyScore * 100 - a.performance.latencyP50Ms / 10 - a.performance.costPerRequest * 1000;
        const sb = b.performance.accuracyScore * 100 - b.performance.latencyP50Ms / 10 - b.performance.costPerRequest * 1000;
        return sb - sa;
      });
    if (!c.length) { logger.warn(`No model found for capability: ${capability}`); return null; }
    return c[0].id;
  }

  routeByContextLength(requiredTokens: number): string | null {
    return Array.from(this.models.values())
      .filter(m => m.metadata.maxContextLength >= requiredTokens && m.stage === 'production' && m.deprecation === 'active')
      .sort((a, b) => a.performance.costPerRequest - b.performance.costPerRequest)[0]?.id ?? null;
  }

  // --- Lineage ---

  getModelLineage(id: string): { model: ModelVersion; ancestors: ModelVersion[] } | undefined {
    const model = this.models.get(id);
    if (!model) return undefined;
    const ancestors: ModelVersion[] = [];
    const visited = new Set<string>();
    let pid = model.lineage.parentModelId;
    while (pid && !visited.has(pid)) {
      visited.add(pid);
      const parent = this.models.get(pid);
      if (!parent) break;
      ancestors.push(parent);
      pid = parent.lineage.parentModelId;
    }
    return { model, ancestors };
  }

  getModelDescendants(id: string): ModelVersion[] {
    return Array.from(this.models.values()).filter(m => m.lineage.parentModelId === id);
  }

  // --- Dashboard ---

  getDashboard(): {
    totalModels: number; byStage: Record<ModelStage, number>; byDeprecation: Record<DeprecationPhase, number>;
    activeABTests: number; activeCanaries: number; activeShadowTests: number;
    unhealthyModels: string[]; totalCost: number;
  } {
    const models = Array.from(this.models.values());
    const byStage: Record<ModelStage, number> = { staging: 0, canary: 0, production: 0, archived: 0 };
    const byDeprecation: Record<DeprecationPhase, number> = { active: 0, deprecated: 0, sunset: 0, removed: 0 };
    for (const m of models) { byStage[m.stage]++; byDeprecation[m.deprecation]++; }

    let totalCost = 0;
    Array.from(this.costLedger.values()).forEach(l => { totalCost += l.reduce((s, e) => s + e.cost, 0); });

    return {
      totalModels: models.length, byStage, byDeprecation,
      activeABTests: Array.from(this.abTests.values()).filter(t => !t.endTime || t.endTime > Date.now()).length,
      activeCanaries: Array.from(this.canaryDeployments.values()).filter(d => d.status === 'in_progress').length,
      activeShadowTests: Array.from(this.shadowTests.values()).filter(t => !t.endTime).length,
      unhealthyModels: models.filter(m => m.stage !== 'archived' && m.deprecation === 'active')
        .filter(m => this.checkModelHealth(m.id).status === 'unhealthy').map(m => m.id),
      totalCost,
    };
  }
}

let defaultManager: AIModelVersionManager | null = null;

export function getModelVersionManager(): AIModelVersionManager {
  if (!defaultManager) { defaultManager = new AIModelVersionManager(); logger.info('AIModelVersionManager initialized'); }
  return defaultManager;
}

export function createModelVersionManager(): AIModelVersionManager {
  return new AIModelVersionManager();
}
