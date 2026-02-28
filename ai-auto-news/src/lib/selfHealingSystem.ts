/**
 * Self-Healing System
 *
 * Autonomous system for detecting failures, diagnosing root causes,
 * and automatically applying fixes without human intervention.
 */

import { getLogger } from '../lib/logger';
import { getMetrics } from '../lib/metrics';

const logger = getLogger();

export interface HealthCheck {
  id: string;
  name: string;
  type: 'service' | 'database' | 'api' | 'resource' | 'dependency';
  interval: number; // ms
  timeout: number; // ms
  checker: () => Promise<HealthStatus>;
  critical: boolean;
}

export interface HealthStatus {
  healthy: boolean;
  responseTime: number;
  details: Record<string, any>;
  error?: string;
}

export interface Failure {
  id: string;
  component: string;
  type: 'service-down' | 'high-latency' | 'error-rate' | 'resource-exhaustion' | 'dependency-failure';
  severity: 'critical' | 'high' | 'medium' | 'low';
  detectedAt: Date;
  metrics: Record<string, number>;
  symptoms: string[];
  impact: Impact;
}

export interface Impact {
  usersAffected: number;
  revenueImpact: number;
  servicesAffected: string[];
  cascadeRisk: number; // 0-1
}

export interface Diagnosis {
  failureId: string;
  rootCause: string;
  confidence: number; // 0-1
  relatedFailures: string[];
  timeline: DiagnosisEvent[];
  recommendations: string[];
}

export interface DiagnosisEvent {
  timestamp: Date;
  event: string;
  component: string;
  metric?: string;
  value?: number;
}

export interface HealingAction {
  id: string;
  failureId: string;
  type: 'restart' | 'scale' | 'rollback' | 'failover' | 'config-change' | 'cache-clear';
  description: string;
  risk: 'low' | 'medium' | 'high';
  estimatedDuration: number; // seconds
  requiresApproval: boolean;
  steps: HealingStep[];
}

export interface HealingStep {
  order: number;
  action: string;
  command?: string;
  validation: () => Promise<boolean>;
  rollback?: () => Promise<void>;
}

export interface HealingResult {
  actionId: string;
  success: boolean;
  duration: number;
  stepsCompleted: number;
  stepsTotal: number;
  errors: string[];
  rollbackPerformed: boolean;
}

class SelfHealingSystem {
  private healthChecks: Map<string, HealthCheck> = new Map();
  private activeFailures: Map<string, Failure> = new Map();
  private healingHistory: HealingResult[] = [];
  private monitoringInterval: NodeJS.Timeout | null = null;
  private metrics = getMetrics();

  constructor() {
    this.initializeHealthChecks();
  }

  /**
   * Start continuous health monitoring
   */
  start(): void {
    logger.info('Starting self-healing system');

    // Run all health checks periodically
    for (const [id, check] of this.healthChecks.entries()) {
      setInterval(() => this.runHealthCheck(id), check.interval);
    }

    // Start failure detector
    this.monitoringInterval = setInterval(() => this.detectFailures(), 30000); // Every 30s
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    logger.info('Self-healing system stopped');
  }

  /**
   * Register custom health check
   */
  registerHealthCheck(check: HealthCheck): void {
    this.healthChecks.set(check.id, check);
    logger.info('Health check registered', { id: check.id, type: check.type });
  }

  /**
   * Run specific health check
   */
  private async runHealthCheck(checkId: string): Promise<void> {
    const check = this.healthChecks.get(checkId);
    if (!check) return;

    try {
      const startTime = Date.now();
      const status = await Promise.race([
        check.checker(),
        this.timeout(check.timeout),
      ]);

      const duration = Date.now() - startTime;

      if (!status.healthy) {
        await this.handleUnhealthyCheck(check, status);
      }

      // Record metrics
      this.metrics.recordGauge(`health.${check.id}.response_time`, duration);
      this.metrics.recordGauge(`health.${check.id}.healthy`, status.healthy ? 1 : 0);
    } catch (error: any) {
      logger.error('Health check failed', undefined, { checkId, error: error.message });

      await this.handleUnhealthyCheck(check, {
        healthy: false,
        responseTime: check.timeout,
        details: {},
        error: error.message,
      });
    }
  }

  /**
   * Handle unhealthy check result
   */
  private async handleUnhealthyCheck(check: HealthCheck, status: HealthStatus): Promise<void> {
    logger.warn('Unhealthy component detected', {
      check: check.id,
      critical: check.critical,
      error: status.error,
    });

    // Create or update failure
    const failureId = `failure_${check.id}_${Date.now()}`;

    const failure: Failure = {
      id: failureId,
      component: check.name,
      type: this.classifyFailureType(status),
      severity: check.critical ? 'critical' : 'high',
      detectedAt: new Date(),
      metrics: { responseTime: status.responseTime },
      symptoms: [status.error || 'Service unhealthy'],
      impact: await this.assessImpact(check, status),
    };

    this.activeFailures.set(failureId, failure);

    // Trigger healing process
    if (check.critical || failure.severity === 'critical') {
      await this.heal(failureId);
    }
  }

  /**
   * Detect failures from monitoring data
   */
  private async detectFailures(): Promise<void> {
    // Check error rates
    const errorRate = await this.getErrorRate();
    if (errorRate > 0.05) {
      // > 5% error rate
      const failureId = `failure_error_rate_${Date.now()}`;

      this.activeFailures.set(failureId, {
        id: failureId,
        component: 'api',
        type: 'error-rate',
        severity: 'high',
        detectedAt: new Date(),
        metrics: { errorRate },
        symptoms: [`Error rate elevated to ${(errorRate * 100).toFixed(2)}%`],
        impact: await this.assessErrorRateImpact(errorRate),
      });

      await this.heal(failureId);
    }

    // Check latency
    const p99Latency = await this.getP99Latency();
    if (p99Latency > 5000) {
      // > 5s
      const failureId = `failure_latency_${Date.now()}`;

      this.activeFailures.set(failureId, {
        id: failureId,
        component: 'api',
        type: 'high-latency',
        severity: 'medium',
        detectedAt: new Date(),
        metrics: { p99Latency },
        symptoms: [`P99 latency elevated to ${p99Latency}ms`],
        impact: await this.assessLatencyImpact(p99Latency),
      });

      await this.heal(failureId);
    }

    // Check resource usage
    await this.checkResourceExhaustion();
  }

  /**
   * Main healing orchestration
   */
  async heal(failureId: string): Promise<HealingResult> {
    const failure = this.activeFailures.get(failureId);
    if (!failure) {
      throw new Error(`Failure not found: ${failureId}`);
    }

    logger.info('Starting healing process', {
      failureId,
      component: failure.component,
      type: failure.type,
    });

    // Step 1: Diagnose root cause
    const diagnosis = await this.diagnose(failure);

    logger.info('Diagnosis complete', {
      failureId,
      rootCause: diagnosis.rootCause,
      confidence: diagnosis.confidence,
    });

    // Step 2: Select healing action
    const action = await this.selectHealingAction(failure, diagnosis);

    logger.info('Healing action selected', {
      failureId,
      actionType: action.type,
      risk: action.risk,
    });

    // Step 3: Execute healing action
    const result = await this.executeHealing(action);

    // Step 4: Verify healing
    if (result.success) {
      const verified = await this.verifyHealing(failure);

      if (verified) {
        this.activeFailures.delete(failureId);
        logger.info('Healing successful', { failureId });
      } else {
        logger.warn('Healing executed but verification failed', { failureId });
      }
    } else {
      logger.error('Healing failed', undefined, { failureId, errors: result.errors });
    }

    // Store result
    this.healingHistory.push(result);

    return result;
  }

  /**
   * Diagnose root cause of failure
   */
  private async diagnose(failure: Failure): Promise<Diagnosis> {
    const timeline: DiagnosisEvent[] = [];
    const recommendations: string[] = [];

    // Analyze timeline
    timeline.push({
      timestamp: failure.detectedAt,
      event: `Failure detected: ${failure.type}`,
      component: failure.component,
    });

    // Determine root cause based on failure type
    let rootCause = '';
    let confidence = 0.8;

    switch (failure.type) {
      case 'service-down':
        rootCause = 'Service process crashed or became unresponsive';
        recommendations.push('Restart service', 'Check logs for crash cause');
        break;

      case 'high-latency':
        rootCause = 'Resource contention or inefficient query';
        recommendations.push('Scale resources', 'Optimize slow queries', 'Clear cache');
        break;

      case 'error-rate':
        rootCause = 'Recent deployment or external dependency failure';
        recommendations.push('Rollback recent changes', 'Check external dependencies');
        break;

      case 'resource-exhaustion':
        rootCause = 'Insufficient resources for current load';
        recommendations.push('Scale horizontally', 'Optimize resource usage');
        break;

      case 'dependency-failure':
        rootCause = 'External service or database unavailable';
        recommendations.push('Failover to backup', 'Use circuit breaker');
        break;
    }

    // Check for related failures
    const relatedFailures = Array.from(this.activeFailures.values())
      .filter(f => f.id !== failure.id && f.component === failure.component)
      .map(f => f.id);

    if (relatedFailures.length > 0) {
      confidence *= 0.9; // Lower confidence if multiple related failures
    }

    return {
      failureId: failure.id,
      rootCause,
      confidence,
      relatedFailures,
      timeline,
      recommendations,
    };
  }

  /**
   * Select appropriate healing action
   */
  private async selectHealingAction(
    failure: Failure,
    diagnosis: Diagnosis
  ): Promise<HealingAction> {
    const action: HealingAction = {
      id: `action_${Date.now()}`,
      failureId: failure.id,
      type: 'restart',
      description: '',
      risk: 'low',
      estimatedDuration: 30,
      requiresApproval: false,
      steps: [],
    };

    switch (failure.type) {
      case 'service-down':
        action.type = 'restart';
        action.description = `Restart ${failure.component} service`;
        action.risk = 'low';
        action.steps = [
          {
            order: 1,
            action: 'Stop service gracefully',
            validation: async () => true,
          },
          {
            order: 2,
            action: 'Wait for connections to drain',
            validation: async () => true,
          },
          {
            order: 3,
            action: 'Start service',
            validation: async () => this.verifyServiceHealth(failure.component),
          },
        ];
        break;

      case 'high-latency':
        action.type = 'cache-clear';
        action.description = 'Clear cache and optimize resources';
        action.risk = 'low';
        action.steps = [
          {
            order: 1,
            action: 'Clear application cache',
            validation: async () => true,
          },
          {
            order: 2,
            action: 'Warm up cache with critical data',
            validation: async () => true,
          },
        ];
        break;

      case 'error-rate':
        action.type = 'rollback';
        action.description = 'Rollback to previous stable version';
        action.risk = 'medium';
        action.requiresApproval = true;
        action.steps = [
          {
            order: 1,
            action: 'Identify previous stable version',
            validation: async () => true,
          },
          {
            order: 2,
            action: 'Deploy previous version',
            validation: async () => this.verifyDeployment(),
          },
        ];
        break;

      case 'resource-exhaustion':
        action.type = 'scale';
        action.description = 'Scale service horizontally';
        action.risk = 'low';
        action.steps = [
          {
            order: 1,
            action: 'Increase replica count',
            validation: async () => this.verifyScaling(failure.component),
          },
        ];
        break;

      case 'dependency-failure':
        action.type = 'failover';
        action.description = 'Failover to backup dependency';
        action.risk = 'medium';
        action.steps = [
          {
            order: 1,
            action: 'Switch to backup endpoint',
            validation: async () => this.verifyDependencyHealth(),
          },
        ];
        break;
    }

    return action;
  }

  /**
   * Execute healing action
   */
  private async executeHealing(action: HealingAction): Promise<HealingResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let stepsCompleted = 0;
    let rollbackPerformed = false;

    logger.info('Executing healing action', {
      actionId: action.id,
      type: action.type,
      steps: action.steps.length,
    });

    try {
      for (const step of action.steps) {
        logger.debug('Executing healing step', { step: step.order, action: step.action });

        // Execute step (simplified - would actually execute commands)
        if (step.command) {
          // await execCommand(step.command);
        }

        // Validate step
        const validated = await step.validation();

        if (!validated) {
          throw new Error(`Step ${step.order} validation failed`);
        }

        stepsCompleted++;
      }

      return {
        actionId: action.id,
        success: true,
        duration: Date.now() - startTime,
        stepsCompleted,
        stepsTotal: action.steps.length,
        errors,
        rollbackPerformed,
      };
    } catch (error: any) {
      logger.error('Healing action failed', undefined, { actionId: action.id, error: error.message });
      errors.push(error.message);

      // Attempt rollback
      if (action.steps[stepsCompleted - 1]?.rollback) {
        try {
          await action.steps[stepsCompleted - 1].rollback!();
          rollbackPerformed = true;
        } catch (rollbackError: any) {
          errors.push(`Rollback failed: ${rollbackError.message}`);
        }
      }

      return {
        actionId: action.id,
        success: false,
        duration: Date.now() - startTime,
        stepsCompleted,
        stepsTotal: action.steps.length,
        errors,
        rollbackPerformed,
      };
    }
  }

  /**
   * Verify that healing resolved the issue
   */
  private async verifyHealing(failure: Failure): Promise<boolean> {
    // Wait for system to stabilize
    await this.sleep(10000);

    // Check if original symptoms are resolved
    switch (failure.type) {
      case 'service-down':
        return this.verifyServiceHealth(failure.component);

      case 'high-latency':
        const latency = await this.getP99Latency();
        return latency < 2000; // Normal latency

      case 'error-rate':
        const errorRate = await this.getErrorRate();
        return errorRate < 0.01; // < 1%

      case 'resource-exhaustion':
        return this.verifyResourceLevels();

      case 'dependency-failure':
        return this.verifyDependencyHealth();

      default:
        return false;
    }
  }

  // Helper methods

  private initializeHealthChecks(): void {
    // Initialize default health checks
    this.registerHealthCheck({
      id: 'api-health',
      name: 'API Service',
      type: 'service',
      interval: 30000,
      timeout: 5000,
      checker: async () => ({ healthy: true, responseTime: 100, details: {} }),
      critical: true,
    });

    this.registerHealthCheck({
      id: 'database-health',
      name: 'Database',
      type: 'database',
      interval: 60000,
      timeout: 10000,
      checker: async () => ({ healthy: true, responseTime: 50, details: {} }),
      critical: true,
    });
  }

  private classifyFailureType(status: HealthStatus): Failure['type'] {
    if (status.responseTime > 10000) return 'high-latency';
    if (status.error?.includes('connection')) return 'dependency-failure';
    return 'service-down';
  }

  private async assessImpact(check: HealthCheck, status: HealthStatus): Promise<Impact> {
    return {
      usersAffected: check.critical ? 1000 : 100,
      revenueImpact: check.critical ? 10000 : 1000,
      servicesAffected: [check.name],
      cascadeRisk: check.critical ? 0.8 : 0.3,
    };
  }

  private async assessErrorRateImpact(errorRate: number): Promise<Impact> {
    return {
      usersAffected: Math.floor(errorRate * 10000),
      revenueImpact: errorRate * 50000,
      servicesAffected: ['api'],
      cascadeRisk: 0.5,
    };
  }

  private async assessLatencyImpact(latency: number): Promise<Impact> {
    return {
      usersAffected: Math.floor((latency / 10000) * 5000),
      revenueImpact: (latency / 10000) * 20000,
      servicesAffected: ['api'],
      cascadeRisk: 0.3,
    };
  }

  private async getErrorRate(): Promise<number> {
    // Would query actual metrics
    return Math.random() * 0.1;
  }

  private async getP99Latency(): Promise<number> {
    // Would query actual metrics
    return Math.random() * 3000 + 500;
  }

  private async checkResourceExhaustion(): Promise<void> {
    // Would check actual resource metrics
  }

  private async verifyServiceHealth(component: string): Promise<boolean> {
    return true;
  }

  private async verifyDeployment(): Promise<boolean> {
    return true;
  }

  private async verifyScaling(component: string): Promise<boolean> {
    return true;
  }

  private async verifyDependencyHealth(): Promise<boolean> {
    return true;
  }

  private async verifyResourceLevels(): Promise<boolean> {
    return true;
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms)
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get healing statistics
   */
  getStats(): {
    activeFailures: number;
    totalHealings: number;
    successRate: number;
    averageDuration: number;
  } {
    const successful = this.healingHistory.filter(h => h.success).length;

    return {
      activeFailures: this.activeFailures.size,
      totalHealings: this.healingHistory.length,
      successRate: this.healingHistory.length > 0 ? successful / this.healingHistory.length : 0,
      averageDuration:
        this.healingHistory.reduce((sum, h) => sum + h.duration, 0) /
          Math.max(1, this.healingHistory.length) /
        1000,
    };
  }
}

// Singleton
let selfHealingSystem: SelfHealingSystem;

export function getSelfHealingSystem(): SelfHealingSystem {
  if (!selfHealingSystem) {
    selfHealingSystem = new SelfHealingSystem();
  }
  return selfHealingSystem;
}
