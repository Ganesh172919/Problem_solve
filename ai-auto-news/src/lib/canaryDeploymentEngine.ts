/**
 * Canary Deployment Engine
 *
 * Progressive deployment with traffic splitting, metrics comparison,
 * automatic rollback, and deployment health scoring.
 */

import { getLogger } from './logger';

const logger = getLogger();

export interface DeploymentConfig {
  id: string;
  name: string;
  service: string;
  version: string;
  previousVersion: string;
  strategy: DeploymentStrategy;
  phases: DeploymentPhase[];
  healthChecks: HealthCheck[];
  rollbackTriggers: RollbackTrigger[];
  metadata: Record<string, unknown>;
  status: DeploymentStatus;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export type DeploymentStatus = 'pending' | 'in_progress' | 'paused' | 'rolling_back' | 'completed' | 'failed';

export interface DeploymentStrategy {
  type: 'canary' | 'blue_green' | 'rolling' | 'a_b_test';
  initialCanaryPercent: number;
  maxCanaryPercent: number;
  incrementPercent: number;
  evaluationPeriodMs: number;
  minSampleSize: number;
}

export interface DeploymentPhase {
  id: string;
  name: string;
  trafficPercent: number;
  durationMs: number;
  metrics: PhaseMetrics;
  status: 'pending' | 'active' | 'passed' | 'failed';
  startedAt: number | null;
  completedAt: number | null;
}

export interface PhaseMetrics {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  successRate: number;
  saturationPercent: number;
}

export interface HealthCheck {
  id: string;
  name: string;
  type: 'http' | 'tcp' | 'script' | 'metric';
  target: string;
  intervalMs: number;
  timeoutMs: number;
  threshold: number;
  currentValue: number;
  status: 'passing' | 'warning' | 'failing';
  lastChecked: number | null;
}

export interface RollbackTrigger {
  id: string;
  metric: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte';
  threshold: number;
  windowMs: number;
  action: 'rollback' | 'pause' | 'alert';
  triggered: boolean;
}

export interface DeploymentComparison {
  canaryMetrics: PhaseMetrics;
  baselineMetrics: PhaseMetrics;
  healthScore: number;
  degradationDetected: boolean;
  details: ComparisonDetail[];
  recommendation: 'promote' | 'rollback' | 'continue' | 'investigate';
}

export interface ComparisonDetail {
  metric: string;
  canaryValue: number;
  baselineValue: number;
  changePercent: number;
  status: 'better' | 'same' | 'worse' | 'critical';
}

export interface DeploymentEvent {
  id: string;
  deploymentId: string;
  type: 'started' | 'phase_advanced' | 'traffic_shifted' | 'health_check' | 'rollback_triggered' | 'completed' | 'failed';
  message: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export class CanaryDeploymentEngine {
  private deployments: Map<string, DeploymentConfig> = new Map();
  private events: Map<string, DeploymentEvent[]> = new Map();
  private baselineMetrics: Map<string, PhaseMetrics> = new Map();
  private evaluationTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  createDeployment(params: {
    name: string;
    service: string;
    version: string;
    previousVersion: string;
    strategy?: Partial<DeploymentStrategy>;
    healthChecks?: HealthCheck[];
    rollbackTriggers?: RollbackTrigger[];
  }): DeploymentConfig {
    const strategy: DeploymentStrategy = {
      type: 'canary',
      initialCanaryPercent: 5,
      maxCanaryPercent: 100,
      incrementPercent: 10,
      evaluationPeriodMs: 300000,
      minSampleSize: 100,
      ...params.strategy,
    };

    const phases = this.generatePhases(strategy);

    const deployment: DeploymentConfig = {
      id: `deploy_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      name: params.name,
      service: params.service,
      version: params.version,
      previousVersion: params.previousVersion,
      strategy,
      phases,
      healthChecks: params.healthChecks || this.defaultHealthChecks(params.service),
      rollbackTriggers: params.rollbackTriggers || this.defaultRollbackTriggers(),
      metadata: {},
      status: 'pending',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
    };

    this.deployments.set(deployment.id, deployment);
    this.events.set(deployment.id, []);

    logger.info('Deployment created', {
      deploymentId: deployment.id,
      service: deployment.service,
      version: deployment.version,
    });

    return deployment;
  }

  startDeployment(deploymentId: string): boolean {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment || deployment.status !== 'pending') return false;

    deployment.status = 'in_progress';
    deployment.startedAt = Date.now();

    if (deployment.phases.length > 0) {
      deployment.phases[0].status = 'active';
      deployment.phases[0].startedAt = Date.now();
    }

    this.recordEvent(deploymentId, 'started', `Deployment ${deployment.name} started`, {
      version: deployment.version,
      initialTraffic: deployment.strategy.initialCanaryPercent,
    });

    return true;
  }

  recordMetrics(deploymentId: string, metrics: Partial<PhaseMetrics>): boolean {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment || deployment.status !== 'in_progress') return false;

    const activePhase = deployment.phases.find((p) => p.status === 'active');
    if (!activePhase) return false;

    if (metrics.requestCount) activePhase.metrics.requestCount += metrics.requestCount;
    if (metrics.errorCount) activePhase.metrics.errorCount += metrics.errorCount;
    if (metrics.avgLatencyMs) {
      const total = activePhase.metrics.avgLatencyMs * (activePhase.metrics.requestCount - (metrics.requestCount || 0));
      activePhase.metrics.avgLatencyMs =
        (total + metrics.avgLatencyMs * (metrics.requestCount || 0)) / activePhase.metrics.requestCount;
    }
    if (metrics.p95LatencyMs) activePhase.metrics.p95LatencyMs = metrics.p95LatencyMs;
    if (metrics.p99LatencyMs) activePhase.metrics.p99LatencyMs = metrics.p99LatencyMs;

    activePhase.metrics.errorRate =
      activePhase.metrics.requestCount > 0
        ? activePhase.metrics.errorCount / activePhase.metrics.requestCount
        : 0;
    activePhase.metrics.successRate = 1 - activePhase.metrics.errorRate;

    this.checkRollbackTriggers(deployment);
    return true;
  }

  setBaselineMetrics(deploymentId: string, metrics: PhaseMetrics): void {
    this.baselineMetrics.set(deploymentId, metrics);
  }

  evaluatePhase(deploymentId: string): DeploymentComparison | null {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) return null;

    const activePhase = deployment.phases.find((p) => p.status === 'active');
    if (!activePhase) return null;

    const baseline = this.baselineMetrics.get(deploymentId) || this.getDefaultBaseline();

    return this.compareMetrics(activePhase.metrics, baseline);
  }

  advancePhase(deploymentId: string): boolean {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment || deployment.status !== 'in_progress') return false;

    const activePhaseIndex = deployment.phases.findIndex((p) => p.status === 'active');
    if (activePhaseIndex === -1) return false;

    deployment.phases[activePhaseIndex].status = 'passed';
    deployment.phases[activePhaseIndex].completedAt = Date.now();

    if (activePhaseIndex < deployment.phases.length - 1) {
      const nextPhase = deployment.phases[activePhaseIndex + 1];
      nextPhase.status = 'active';
      nextPhase.startedAt = Date.now();

      this.recordEvent(deploymentId, 'phase_advanced', `Advanced to phase: ${nextPhase.name}`, {
        trafficPercent: nextPhase.trafficPercent,
      });
    } else {
      deployment.status = 'completed';
      deployment.completedAt = Date.now();

      this.recordEvent(deploymentId, 'completed', `Deployment ${deployment.name} completed successfully`, {
        totalDuration: Date.now() - (deployment.startedAt || 0),
      });
    }

    return true;
  }

  rollback(deploymentId: string, reason: string = 'manual'): boolean {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) return false;

    deployment.status = 'rolling_back';

    for (const phase of deployment.phases) {
      if (phase.status === 'active') {
        phase.status = 'failed';
        phase.completedAt = Date.now();
      }
    }

    this.recordEvent(deploymentId, 'rollback_triggered', `Rollback triggered: ${reason}`, {
      previousVersion: deployment.previousVersion,
    });

    deployment.status = 'failed';
    deployment.completedAt = Date.now();

    logger.warn('Deployment rolled back', { deploymentId, reason });
    return true;
  }

  getDeployment(deploymentId: string): DeploymentConfig | undefined {
    return this.deployments.get(deploymentId);
  }

  getActiveDeployments(): DeploymentConfig[] {
    return Array.from(this.deployments.values()).filter(
      (d) => d.status === 'in_progress' || d.status === 'paused',
    );
  }

  getDeploymentHistory(service?: string, limit?: number): DeploymentConfig[] {
    let deployments = Array.from(this.deployments.values());
    if (service) {
      deployments = deployments.filter((d) => d.service === service);
    }
    deployments.sort((a, b) => b.createdAt - a.createdAt);
    return limit ? deployments.slice(0, limit) : deployments;
  }

  getEvents(deploymentId: string): DeploymentEvent[] {
    return this.events.get(deploymentId) || [];
  }

  getCurrentTrafficSplit(deploymentId: string): { canary: number; baseline: number } {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) return { canary: 0, baseline: 100 };

    const activePhase = deployment.phases.find((p) => p.status === 'active');
    const canary = activePhase?.trafficPercent || 0;
    return { canary, baseline: 100 - canary };
  }

  getDeploymentStats(): {
    total: number;
    successful: number;
    failed: number;
    inProgress: number;
    avgDurationMs: number;
    successRate: number;
  } {
    const deployments = Array.from(this.deployments.values());
    const completed = deployments.filter((d) => d.status === 'completed');
    const failed = deployments.filter((d) => d.status === 'failed');
    const inProgress = deployments.filter((d) => d.status === 'in_progress');

    const durations = completed
      .filter((d) => d.startedAt && d.completedAt)
      .map((d) => d.completedAt! - d.startedAt!);

    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return {
      total: deployments.length,
      successful: completed.length,
      failed: failed.length,
      inProgress: inProgress.length,
      avgDurationMs: Math.round(avgDuration),
      successRate: deployments.length > 0 ? completed.length / deployments.length : 0,
    };
  }

  private generatePhases(strategy: DeploymentStrategy): DeploymentPhase[] {
    const phases: DeploymentPhase[] = [];
    let traffic = strategy.initialCanaryPercent;
    let phaseIndex = 0;

    while (traffic <= strategy.maxCanaryPercent) {
      phases.push({
        id: `phase_${phaseIndex}`,
        name: `Phase ${phaseIndex + 1} (${traffic}%)`,
        trafficPercent: traffic,
        durationMs: strategy.evaluationPeriodMs,
        metrics: this.emptyMetrics(),
        status: 'pending',
        startedAt: null,
        completedAt: null,
      });

      if (traffic >= strategy.maxCanaryPercent) break;
      traffic = Math.min(traffic + strategy.incrementPercent, strategy.maxCanaryPercent);
      phaseIndex++;
    }

    return phases;
  }

  private defaultHealthChecks(service: string): HealthCheck[] {
    return [
      {
        id: 'hc_http',
        name: 'HTTP Health',
        type: 'http',
        target: `/api/health`,
        intervalMs: 10000,
        timeoutMs: 5000,
        threshold: 0.95,
        currentValue: 1,
        status: 'passing',
        lastChecked: null,
      },
      {
        id: 'hc_latency',
        name: 'Latency Check',
        type: 'metric',
        target: 'p99_latency_ms',
        intervalMs: 30000,
        timeoutMs: 5000,
        threshold: 500,
        currentValue: 0,
        status: 'passing',
        lastChecked: null,
      },
    ];
  }

  private defaultRollbackTriggers(): RollbackTrigger[] {
    return [
      {
        id: 'rt_error_rate',
        metric: 'error_rate',
        operator: 'gt',
        threshold: 0.05,
        windowMs: 300000,
        action: 'rollback',
        triggered: false,
      },
      {
        id: 'rt_latency',
        metric: 'p99_latency_ms',
        operator: 'gt',
        threshold: 2000,
        windowMs: 300000,
        action: 'pause',
        triggered: false,
      },
    ];
  }

  private checkRollbackTriggers(deployment: DeploymentConfig): void {
    const activePhase = deployment.phases.find((p) => p.status === 'active');
    if (!activePhase) return;

    for (const trigger of deployment.rollbackTriggers) {
      if (trigger.triggered) continue;

      const value = this.getMetricValue(activePhase.metrics, trigger.metric);
      const shouldTrigger = this.evaluateTrigger(value, trigger.operator, trigger.threshold);

      if (shouldTrigger) {
        trigger.triggered = true;
        if (trigger.action === 'rollback') {
          this.rollback(deployment.id, `Trigger ${trigger.id}: ${trigger.metric} ${trigger.operator} ${trigger.threshold}`);
        } else if (trigger.action === 'pause') {
          deployment.status = 'paused';
          this.recordEvent(deployment.id, 'rollback_triggered', `Deployment paused: ${trigger.metric} exceeded threshold`, {});
        }
      }
    }
  }

  private getMetricValue(metrics: PhaseMetrics, metricName: string): number {
    switch (metricName) {
      case 'error_rate': return metrics.errorRate;
      case 'success_rate': return metrics.successRate;
      case 'avg_latency_ms': return metrics.avgLatencyMs;
      case 'p95_latency_ms': return metrics.p95LatencyMs;
      case 'p99_latency_ms': return metrics.p99LatencyMs;
      default: return 0;
    }
  }

  private evaluateTrigger(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      default: return false;
    }
  }

  private compareMetrics(canary: PhaseMetrics, baseline: PhaseMetrics): DeploymentComparison {
    const details: ComparisonDetail[] = [
      this.compareMetric('error_rate', canary.errorRate, baseline.errorRate, true),
      this.compareMetric('avg_latency', canary.avgLatencyMs, baseline.avgLatencyMs, true),
      this.compareMetric('p99_latency', canary.p99LatencyMs, baseline.p99LatencyMs, true),
      this.compareMetric('success_rate', canary.successRate, baseline.successRate, false),
    ];

    const criticalCount = details.filter((d) => d.status === 'critical').length;
    const worseCount = details.filter((d) => d.status === 'worse').length;
    const healthScore = Math.max(0, 1 - criticalCount * 0.3 - worseCount * 0.1);

    let recommendation: 'promote' | 'rollback' | 'continue' | 'investigate';
    if (criticalCount > 0) recommendation = 'rollback';
    else if (worseCount > 1) recommendation = 'investigate';
    else if (healthScore >= 0.8) recommendation = 'promote';
    else recommendation = 'continue';

    return {
      canaryMetrics: canary,
      baselineMetrics: baseline,
      healthScore,
      degradationDetected: criticalCount > 0 || worseCount > 1,
      details,
      recommendation,
    };
  }

  private compareMetric(name: string, canaryVal: number, baselineVal: number, lowerIsBetter: boolean): ComparisonDetail {
    const changePercent = baselineVal !== 0 ? ((canaryVal - baselineVal) / baselineVal) * 100 : 0;
    let status: 'better' | 'same' | 'worse' | 'critical';

    const absChange = Math.abs(changePercent);
    if (absChange < 5) {
      status = 'same';
    } else if (lowerIsBetter) {
      status = changePercent < -5 ? 'better' : changePercent > 20 ? 'critical' : 'worse';
    } else {
      status = changePercent > 5 ? 'better' : changePercent < -20 ? 'critical' : 'worse';
    }

    return { metric: name, canaryValue: canaryVal, baselineValue: baselineVal, changePercent: parseFloat(changePercent.toFixed(2)), status };
  }

  private emptyMetrics(): PhaseMetrics {
    return { requestCount: 0, errorCount: 0, errorRate: 0, avgLatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0, successRate: 1, saturationPercent: 0 };
  }

  private getDefaultBaseline(): PhaseMetrics {
    return { requestCount: 1000, errorCount: 10, errorRate: 0.01, avgLatencyMs: 100, p95LatencyMs: 200, p99LatencyMs: 400, successRate: 0.99, saturationPercent: 0.3 };
  }

  private recordEvent(deploymentId: string, type: DeploymentEvent['type'], message: string, metadata: Record<string, unknown>): void {
    const events = this.events.get(deploymentId) || [];
    events.push({
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      deploymentId,
      type,
      message,
      metadata,
      timestamp: Date.now(),
    });
    this.events.set(deploymentId, events);
  }
}

let deploymentEngineInstance: CanaryDeploymentEngine | null = null;

export function getCanaryDeploymentEngine(): CanaryDeploymentEngine {
  if (!deploymentEngineInstance) {
    deploymentEngineInstance = new CanaryDeploymentEngine();
  }
  return deploymentEngineInstance;
}
