/**
 * Autonomous Deployment Agent
 *
 * Orchestrates software deployments with intelligent rollback, canary analysis,
 * health gate evaluation, and risk-aware release decisions. Supports blue/green,
 * canary, and rolling deployment strategies with autonomous promotion/rollback.
 */

import { getLogger } from '../lib/logger';

const logger = getLogger();

export interface DeploymentPlan {
  planId: string;
  service: string;
  version: string;
  previousVersion: string;
  strategy: DeploymentStrategy;
  canaryConfig?: CanaryConfig;
  healthGates: HealthGate[];
  rollbackStrategy: RollbackStrategy;
  risk: DeploymentRisk;
  artifacts: ArtifactBundle[];
  tenantId?: string;
  createdAt: number;
  scheduledAt?: number;
  estimatedDurationMs: number;
}

export type DeploymentStrategy = 'blue_green' | 'canary' | 'rolling' | 'recreate';

export interface CanaryConfig {
  initialTrafficPct: number;
  incrementPct: number;
  incrementIntervalMs: number;
  maxTrafficPct: number;
  successThreshold: number;
  errorRateThreshold: number;
  latencyThresholdMs: number;
  autoPromote: boolean;
}

export interface RollbackStrategy {
  mode: 'automatic' | 'manual' | 'semi-automatic';
  triggerConditions: RollbackTrigger[];
  maxRollbackAttempts: number;
  rollbackTimeoutMs: number;
  preserveState: boolean;
}

export interface RollbackTrigger {
  metric: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte';
  threshold: number;
  windowMs: number;
  consecutiveBreaches: number;
}

export interface DeploymentRisk {
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactor[];
  recommendation: string;
  approvalRequired: boolean;
}

export interface RiskFactor {
  name: string;
  weight: number;
  value: number;
  description: string;
}

export interface HealthGate {
  gateId: string;
  name: string;
  metric: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  threshold: number;
  timeoutMs: number;
  critical: boolean;
  currentValue?: number;
  passed?: boolean;
  evaluatedAt?: number;
}

export interface DeploymentDecision {
  deploymentId: string;
  action: 'proceed' | 'pause' | 'rollback' | 'promote' | 'abort';
  reason: string;
  confidence: number;
  observations: DeploymentObservation[];
  decidedAt: number;
  automatedAction: boolean;
}

export interface ArtifactBundle {
  artifactId: string;
  type: 'docker_image' | 'helm_chart' | 'zip' | 'jar' | 'binary';
  name: string;
  version: string;
  checksum: string;
  sizeBytes: number;
  registry?: string;
  verified: boolean;
}

export interface DeploymentObservation {
  timestamp: number;
  metric: string;
  value: number;
  baseline?: number;
  deviation?: number;
  anomalous: boolean;
}

export interface DeploymentRecord {
  deploymentId: string;
  planId: string;
  service: string;
  version: string;
  previousVersion: string;
  strategy: DeploymentStrategy;
  status: DeploymentStatus;
  startedAt: number;
  completedAt?: number;
  rollbackAt?: number;
  canaryTrafficPct: number;
  observations: DeploymentObservation[];
  decisions: DeploymentDecision[];
  healthGateResults: HealthGate[];
  outcome?: DeploymentOutcome;
  tenantId?: string;
}

export type DeploymentStatus =
  | 'pending'
  | 'deploying'
  | 'canary'
  | 'promoting'
  | 'rolling_back'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export interface DeploymentOutcome {
  success: boolean;
  mttr?: number;
  errorRate: number;
  p99LatencyMs: number;
  rollbackTriggered: boolean;
  rollbackReason?: string;
  lessonsLearned: string[];
}

export interface DeploymentReport {
  reportId: string;
  deploymentId: string;
  service: string;
  version: string;
  strategy: DeploymentStrategy;
  duration: number;
  outcome: DeploymentOutcome;
  healthGateSummary: { passed: number; failed: number; skipped: number };
  observationsSummary: { total: number; anomalies: number };
  decisions: DeploymentDecision[];
  generatedAt: number;
}

export class AutonomousDeploymentAgent {
  private plans = new Map<string, DeploymentPlan>();
  private deployments = new Map<string, DeploymentRecord>();
  private strategyHistory = new Map<string, DeploymentOutcome[]>();
  private monitoringIntervals = new Map<string, ReturnType<typeof setInterval>>();

  planDeployment(config: {
    service: string;
    version: string;
    previousVersion: string;
    strategy?: DeploymentStrategy;
    tenantId?: string;
    artifacts: Omit<ArtifactBundle, 'verified'>[];
    customHealthGates?: Partial<HealthGate>[];
    canaryOverrides?: Partial<CanaryConfig>;
  }): DeploymentPlan {
    const strategy = config.strategy ?? this.selectStrategy(config.service, config.version);
    const risk = this.assessRisk(config);
    const canaryConfig = strategy === 'canary' ? this.buildCanaryConfig(config.canaryOverrides) : undefined;

    const plan: DeploymentPlan = {
      planId: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      service: config.service,
      version: config.version,
      previousVersion: config.previousVersion,
      strategy,
      canaryConfig,
      healthGates: this.buildHealthGates(config.service, config.customHealthGates),
      rollbackStrategy: this.buildRollbackStrategy(risk),
      risk,
      artifacts: config.artifacts.map(a => ({ ...a, verified: this.verifyArtifact(a) })),
      tenantId: config.tenantId,
      createdAt: Date.now(),
      estimatedDurationMs: this.estimateDuration(strategy),
    };

    this.plans.set(plan.planId, plan);

    logger.info('Deployment plan created', {
      planId: plan.planId,
      service: plan.service,
      version: plan.version,
      strategy,
      riskLevel: risk.level,
    });

    return plan;
  }

  executeDeployment(planId: string): DeploymentRecord {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Deployment plan ${planId} not found`);

    if (plan.risk.approvalRequired) {
      logger.warn('Deployment requires manual approval', { planId, riskLevel: plan.risk.level });
    }

    const unverified = plan.artifacts.filter(a => !a.verified);
    if (unverified.length > 0) {
      throw new Error(`Artifacts not verified: ${unverified.map(a => a.name).join(', ')}`);
    }

    const deployment: DeploymentRecord = {
      deploymentId: `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      planId,
      service: plan.service,
      version: plan.version,
      previousVersion: plan.previousVersion,
      strategy: plan.strategy,
      status: 'deploying',
      startedAt: Date.now(),
      canaryTrafficPct: plan.strategy === 'canary' ? (plan.canaryConfig?.initialTrafficPct ?? 5) : 100,
      observations: [],
      decisions: [],
      healthGateResults: plan.healthGates.map(g => ({ ...g })),
      tenantId: plan.tenantId,
    };

    this.deployments.set(deployment.deploymentId, deployment);
    this.startMonitoring(deployment.deploymentId, plan);

    logger.info('Deployment started', {
      deploymentId: deployment.deploymentId,
      service: plan.service,
      version: plan.version,
      strategy: plan.strategy,
    });

    return deployment;
  }

  monitorDeployment(deploymentId: string): DeploymentRecord {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

    const freshObservations = this.collectObservations(deployment);
    deployment.observations.push(...freshObservations);

    const anomalies = freshObservations.filter(o => o.anomalous);
    if (anomalies.length > 0) {
      logger.warn('Anomalies detected during deployment', {
        deploymentId,
        anomalies: anomalies.map(a => ({ metric: a.metric, value: a.value, baseline: a.baseline })),
      });
    }

    return deployment;
  }

  evaluateHealth(deploymentId: string): { allPassed: boolean; gates: HealthGate[] } {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

    const plan = this.plans.get(deployment.planId)!;
    let allPassed = true;

    for (const gate of deployment.healthGateResults) {
      const currentValue = this.fetchMetric(gate.metric, deployment.service);
      gate.currentValue = currentValue;
      gate.evaluatedAt = Date.now();
      gate.passed = this.evaluateGate(gate, currentValue);

      if (!gate.passed && gate.critical) {
        allPassed = false;
        logger.warn('Critical health gate failed', {
          deploymentId,
          gate: gate.name,
          metric: gate.metric,
          currentValue,
          threshold: gate.threshold,
        });

        if (plan.rollbackStrategy.mode === 'automatic') {
          this.triggerRollback(deploymentId, `Critical health gate failed: ${gate.name}`);
        }
      }
    }

    return { allPassed, gates: deployment.healthGateResults };
  }

  triggerRollback(deploymentId: string, reason: string): void {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

    if (deployment.status === 'rolled_back' || deployment.status === 'completed') {
      logger.info('Rollback skipped – deployment already in terminal state', { deploymentId, status: deployment.status });
      return;
    }

    deployment.status = 'rolling_back';
    deployment.rollbackAt = Date.now();

    const decision: DeploymentDecision = {
      deploymentId,
      action: 'rollback',
      reason,
      confidence: 0.95,
      observations: deployment.observations.slice(-10),
      decidedAt: Date.now(),
      automatedAction: true,
    };
    deployment.decisions.push(decision);

    this.stopMonitoring(deploymentId);

    // Simulate rollback execution
    setTimeout(() => {
      deployment.status = 'rolled_back';
      deployment.completedAt = Date.now();
      deployment.outcome = {
        success: false,
        errorRate: this.computeErrorRate(deployment.observations),
        p99LatencyMs: this.computeP99Latency(deployment.observations),
        rollbackTriggered: true,
        rollbackReason: reason,
        lessonsLearned: this.inferLessons(deployment, reason),
      };

      logger.warn('Rollback completed', {
        deploymentId,
        service: deployment.service,
        previousVersion: deployment.previousVersion,
        reason,
      });
    }, 5000);

    logger.warn('Rollback initiated', { deploymentId, reason });
  }

  optimizeStrategy(historyKey: string): { recommendedStrategy: DeploymentStrategy; rationale: string } {
    const history = this.strategyHistory.get(historyKey) ?? [];
    if (history.length === 0) {
      return { recommendedStrategy: 'canary', rationale: 'No history; defaulting to lowest-risk canary strategy' };
    }

    const successRates: Record<DeploymentStrategy, { success: number; total: number }> = {
      blue_green: { success: 0, total: 0 },
      canary: { success: 0, total: 0 },
      rolling: { success: 0, total: 0 },
      recreate: { success: 0, total: 0 },
    };

    Array.from(this.deployments.values())
      .filter(d => d.outcome)
      .forEach(d => {
        const rec = successRates[d.strategy];
        rec.total++;
        if (d.outcome!.success) rec.success++;
      });

    let best: DeploymentStrategy = 'canary';
    let bestRate = -1;

    for (const [strategy, stats] of Object.entries(successRates) as [DeploymentStrategy, typeof successRates[DeploymentStrategy]][]) {
      if (stats.total === 0) continue;
      const rate = stats.success / stats.total;
      if (rate > bestRate) {
        bestRate = rate;
        best = strategy;
      }
    }

    return {
      recommendedStrategy: best,
      rationale: `Historical success rate of ${(bestRate * 100).toFixed(1)}% for ${best} across ${successRates[best].total} deployments`,
    };
  }

  generateDeploymentReport(deploymentId: string): DeploymentReport {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

    const passed = deployment.healthGateResults.filter(g => g.passed).length;
    const failed = deployment.healthGateResults.filter(g => g.passed === false).length;
    const skipped = deployment.healthGateResults.filter(g => g.passed === undefined).length;
    const anomalies = deployment.observations.filter(o => o.anomalous).length;
    const duration = (deployment.completedAt ?? Date.now()) - deployment.startedAt;

    const outcome: DeploymentOutcome = deployment.outcome ?? {
      success: deployment.status === 'completed',
      errorRate: this.computeErrorRate(deployment.observations),
      p99LatencyMs: this.computeP99Latency(deployment.observations),
      rollbackTriggered: deployment.status === 'rolled_back',
      rollbackReason: undefined,
      lessonsLearned: [],
    };

    const report: DeploymentReport = {
      reportId: `report-${Date.now()}`,
      deploymentId,
      service: deployment.service,
      version: deployment.version,
      strategy: deployment.strategy,
      duration,
      outcome,
      healthGateSummary: { passed, failed, skipped },
      observationsSummary: { total: deployment.observations.length, anomalies },
      decisions: deployment.decisions,
      generatedAt: Date.now(),
    };

    logger.info('Deployment report generated', {
      reportId: report.reportId,
      deploymentId,
      success: outcome.success,
      duration,
    });

    return report;
  }

  learnFromOutcome(deploymentId: string, outcome: DeploymentOutcome): void {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) throw new Error(`Deployment ${deploymentId} not found`);

    deployment.outcome = outcome;
    const key = `${deployment.service}:${deployment.strategy}`;
    const history = this.strategyHistory.get(key) ?? [];
    history.push(outcome);
    if (history.length > 100) history.shift();
    this.strategyHistory.set(key, history);

    logger.info('Learned from deployment outcome', {
      deploymentId,
      service: deployment.service,
      strategy: deployment.strategy,
      success: outcome.success,
      rollbackTriggered: outcome.rollbackTriggered,
    });
  }

  getDeployment(deploymentId: string): DeploymentRecord | undefined {
    return this.deployments.get(deploymentId);
  }

  listDeployments(filter?: { service?: string; status?: DeploymentStatus; tenantId?: string }): DeploymentRecord[] {
    let records = Array.from(this.deployments.values());
    if (filter?.service) records = records.filter(d => d.service === filter.service);
    if (filter?.status) records = records.filter(d => d.status === filter.status);
    if (filter?.tenantId) records = records.filter(d => d.tenantId === filter.tenantId);
    return records.sort((a, b) => b.startedAt - a.startedAt);
  }

  private selectStrategy(service: string, version: string): DeploymentStrategy {
    const [major] = version.split('.').map(Number);
    if (major > 0) return 'canary';
    return 'rolling';
  }

  private assessRisk(config: { service: string; version: string; previousVersion: string; artifacts: Omit<ArtifactBundle, 'verified'>[] }): DeploymentRisk {
    const factors: RiskFactor[] = [];

    const [curMajor, curMinor] = config.version.split('.').map(Number);
    const [prevMajor, prevMinor] = config.previousVersion.split('.').map(Number);
    const isMajorBump = curMajor > prevMajor;
    const isMinorBump = !isMajorBump && curMinor > prevMinor;

    factors.push({
      name: 'version_change_magnitude',
      weight: 0.3,
      value: isMajorBump ? 1.0 : isMinorBump ? 0.5 : 0.1,
      description: isMajorBump ? 'Major version bump – high change risk' : isMinorBump ? 'Minor version bump' : 'Patch release',
    });

    const largeArtifacts = config.artifacts.filter(a => (a as ArtifactBundle & { sizeBytes: number }).sizeBytes > 500_000_000);
    factors.push({
      name: 'artifact_size',
      weight: 0.1,
      value: largeArtifacts.length > 0 ? 0.7 : 0.2,
      description: largeArtifacts.length > 0 ? 'Large artifacts increase deployment risk' : 'Artifact size within normal range',
    });

    const historicalOutcomes = Array.from(this.deployments.values())
      .filter(d => d.service === config.service && d.outcome)
      .slice(-10);
    const recentFailureRate = historicalOutcomes.length > 0
      ? historicalOutcomes.filter(d => !d.outcome!.success).length / historicalOutcomes.length
      : 0;

    factors.push({
      name: 'historical_failure_rate',
      weight: 0.4,
      value: recentFailureRate,
      description: `Recent failure rate: ${(recentFailureRate * 100).toFixed(1)}% over last ${historicalOutcomes.length} deployments`,
    });

    factors.push({
      name: 'service_criticality',
      weight: 0.2,
      value: config.service.includes('payment') || config.service.includes('auth') ? 0.9 : 0.3,
      description: 'Service criticality assessment',
    });

    const score = factors.reduce((s, f) => s + f.weight * f.value, 0);
    const level: DeploymentRisk['level'] =
      score >= 0.75 ? 'critical' : score >= 0.5 ? 'high' : score >= 0.25 ? 'medium' : 'low';

    return {
      score,
      level,
      factors,
      recommendation: level === 'critical' || level === 'high'
        ? 'Use canary deployment with small initial traffic and strict health gates'
        : 'Standard rolling deployment acceptable',
      approvalRequired: level === 'critical',
    };
  }

  private buildCanaryConfig(overrides?: Partial<CanaryConfig>): CanaryConfig {
    return {
      initialTrafficPct: 5,
      incrementPct: 10,
      incrementIntervalMs: 300_000,
      maxTrafficPct: 100,
      successThreshold: 0.995,
      errorRateThreshold: 0.01,
      latencyThresholdMs: 500,
      autoPromote: true,
      ...overrides,
    };
  }

  private buildRollbackStrategy(risk: DeploymentRisk): RollbackStrategy {
    return {
      mode: risk.level === 'critical' || risk.level === 'high' ? 'automatic' : 'semi-automatic',
      triggerConditions: [
        { metric: 'error_rate', operator: 'gt', threshold: 0.05, windowMs: 60_000, consecutiveBreaches: 2 },
        { metric: 'p99_latency_ms', operator: 'gt', threshold: 2000, windowMs: 60_000, consecutiveBreaches: 3 },
        { metric: 'availability', operator: 'lt', threshold: 0.99, windowMs: 120_000, consecutiveBreaches: 2 },
      ],
      maxRollbackAttempts: 3,
      rollbackTimeoutMs: 300_000,
      preserveState: true,
    };
  }

  private buildHealthGates(service: string, custom?: Partial<HealthGate>[]): HealthGate[] {
    const defaults: HealthGate[] = [
      { gateId: 'hg-1', name: 'Error Rate', metric: 'error_rate', operator: 'lt', threshold: 0.02, timeoutMs: 120_000, critical: true },
      { gateId: 'hg-2', name: 'P99 Latency', metric: 'p99_latency_ms', operator: 'lt', threshold: 1000, timeoutMs: 120_000, critical: true },
      { gateId: 'hg-3', name: 'Availability', metric: 'availability', operator: 'gte', threshold: 0.999, timeoutMs: 180_000, critical: true },
      { gateId: 'hg-4', name: 'CPU Usage', metric: 'cpu_pct', operator: 'lt', threshold: 80, timeoutMs: 60_000, critical: false },
      { gateId: 'hg-5', name: 'Memory Usage', metric: 'memory_pct', operator: 'lt', threshold: 85, timeoutMs: 60_000, critical: false },
    ];

    if (custom) {
      custom.forEach((c, i) => {
        const base: HealthGate = { gateId: `custom-${i}`, name: 'Custom Gate', metric: '', operator: 'lt', threshold: 0, timeoutMs: 60_000, critical: false };
        defaults.push({ ...base, ...c });
      });
    }

    return defaults;
  }

  private verifyArtifact(artifact: Omit<ArtifactBundle, 'verified'>): boolean {
    // In a real implementation this would verify checksum against a registry
    return artifact.checksum.length === 64 || artifact.checksum.startsWith('sha256:');
  }

  private estimateDuration(strategy: DeploymentStrategy): number {
    const estimates: Record<DeploymentStrategy, number> = {
      blue_green: 300_000,
      canary: 1_800_000,
      rolling: 600_000,
      recreate: 120_000,
    };
    return estimates[strategy];
  }

  private startMonitoring(deploymentId: string, plan: DeploymentPlan): void {
    const interval = setInterval(() => {
      const deployment = this.deployments.get(deploymentId);
      if (!deployment || ['completed', 'failed', 'rolled_back'].includes(deployment.status)) {
        this.stopMonitoring(deploymentId);
        return;
      }

      const observations = this.collectObservations(deployment);
      deployment.observations.push(...observations);

      const healthResult = this.evaluateHealth(deploymentId);

      if (plan.strategy === 'canary' && plan.canaryConfig && healthResult.allPassed) {
        this.advanceCanary(deployment, plan.canaryConfig);
      }
    }, 30_000);

    this.monitoringIntervals.set(deploymentId, interval);
  }

  private stopMonitoring(deploymentId: string): void {
    const interval = this.monitoringIntervals.get(deploymentId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(deploymentId);
    }
  }

  private advanceCanary(deployment: DeploymentRecord, config: CanaryConfig): void {
    if (deployment.canaryTrafficPct >= config.maxTrafficPct) {
      if (config.autoPromote) {
        deployment.status = 'completed';
        deployment.completedAt = Date.now();
        deployment.outcome = {
          success: true,
          errorRate: this.computeErrorRate(deployment.observations),
          p99LatencyMs: this.computeP99Latency(deployment.observations),
          rollbackTriggered: false,
          lessonsLearned: ['Canary promotion successful at full traffic'],
        };
        logger.info('Canary fully promoted', { deploymentId: deployment.deploymentId });
      }
      return;
    }

    deployment.canaryTrafficPct = Math.min(
      deployment.canaryTrafficPct + config.incrementPct,
      config.maxTrafficPct
    );

    const decision: DeploymentDecision = {
      deploymentId: deployment.deploymentId,
      action: 'promote',
      reason: `Health gates passing; advancing canary to ${deployment.canaryTrafficPct}%`,
      confidence: 0.9,
      observations: deployment.observations.slice(-5),
      decidedAt: Date.now(),
      automatedAction: true,
    };
    deployment.decisions.push(decision);

    logger.info('Canary traffic incremented', {
      deploymentId: deployment.deploymentId,
      trafficPct: deployment.canaryTrafficPct,
    });
  }

  private collectObservations(deployment: DeploymentRecord): DeploymentObservation[] {
    const metrics = ['error_rate', 'p99_latency_ms', 'throughput_rps', 'cpu_pct', 'memory_pct'];
    const baselines: Record<string, number> = {
      error_rate: 0.001,
      p99_latency_ms: 200,
      throughput_rps: 500,
      cpu_pct: 30,
      memory_pct: 50,
    };

    return metrics.map(metric => {
      const baseline = baselines[metric] ?? 0;
      const jitter = (Math.random() - 0.5) * 0.2;
      const value = baseline * (1 + jitter);
      const deviation = Math.abs((value - baseline) / Math.max(baseline, 0.001));
      return {
        timestamp: Date.now(),
        metric,
        value,
        baseline,
        deviation,
        anomalous: deviation > 0.15,
      };
    });
  }

  private fetchMetric(metric: string, service: string): number {
    const mockValues: Record<string, number> = {
      error_rate: 0.002,
      p99_latency_ms: 180,
      availability: 0.9998,
      cpu_pct: 35,
      memory_pct: 55,
    };
    return mockValues[metric] ?? 0;
  }

  private evaluateGate(gate: HealthGate, value: number): boolean {
    switch (gate.operator) {
      case 'gt': return value > gate.threshold;
      case 'lt': return value < gate.threshold;
      case 'gte': return value >= gate.threshold;
      case 'lte': return value <= gate.threshold;
      case 'eq': return Math.abs(value - gate.threshold) < 0.0001;
    }
  }

  private computeErrorRate(observations: DeploymentObservation[]): number {
    const errorObs = observations.filter(o => o.metric === 'error_rate');
    if (errorObs.length === 0) return 0;
    return errorObs.reduce((s, o) => s + o.value, 0) / errorObs.length;
  }

  private computeP99Latency(observations: DeploymentObservation[]): number {
    const latObs = observations.filter(o => o.metric === 'p99_latency_ms');
    if (latObs.length === 0) return 0;
    const sorted = latObs.map(o => o.value).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1] ?? 0;
  }

  private inferLessons(deployment: DeploymentRecord, rollbackReason: string): string[] {
    const lessons: string[] = [];
    const errorRate = this.computeErrorRate(deployment.observations);
    if (errorRate > 0.05) lessons.push('Error rate exceeded threshold – review recent code changes');
    if (deployment.canaryTrafficPct < 20) lessons.push('Rollback triggered at low canary traffic – consider pre-prod testing');
    lessons.push(`Rollback triggered by: ${rollbackReason}`);
    return lessons;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __autonomousDeploymentAgent__: AutonomousDeploymentAgent | undefined;
}

export function getAutonomousDeploymentAgent(): AutonomousDeploymentAgent {
  if (!globalThis.__autonomousDeploymentAgent__) {
    globalThis.__autonomousDeploymentAgent__ = new AutonomousDeploymentAgent();
  }
  return globalThis.__autonomousDeploymentAgent__;
}
