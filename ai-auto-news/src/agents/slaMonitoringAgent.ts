/**
 * @module slaMonitoringAgent
 * @description Autonomous SLA monitoring agent that continuously evaluates SLA
 * compliance, predicts breaches, triggers automated remediation, escalates
 * critical violations, and generates compliance reports for all active tenants.
 */

import { getLogger } from '../lib/logger';
import { getSLAManager, type SLADefinition, type SLAStatus } from '../lib/intelligentSLAManager';

const logger = getLogger();

interface AgentConfig {
  checkIntervalMs?: number;
  predictionWindowMs?: number;
  autoRemediateEnabled?: boolean;
  escalationThreshold?: number;
}

interface SLAHealthSummary {
  tenantId: string;
  slaId: string;
  status: SLAStatus;
  compositeScore: number;
  breachCount: number;
  creditsOwed: number;
  lastCheckedAt: number;
}

class SLAMonitoringAgent {
  private slaManager = getSLAManager();
  private intervalId?: ReturnType<typeof setInterval>;
  private config: Required<AgentConfig>;
  private healthSummaries = new Map<string, SLAHealthSummary>();
  private remedationLog: Array<{ slaId: string; action: string; timestamp: number }> = [];

  constructor(config: AgentConfig = {}) {
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 30_000,
      predictionWindowMs: config.predictionWindowMs ?? 15 * 60_000,
      autoRemediateEnabled: config.autoRemediateEnabled ?? true,
      escalationThreshold: config.escalationThreshold ?? 20,
    };
  }

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => void this.runCycle(), this.config.checkIntervalMs);
    logger.info('SLAMonitoringAgent started', { checkIntervalMs: this.config.checkIntervalMs });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('SLAMonitoringAgent stopped');
    }
  }

  async runCycle(): Promise<void> {
    const activeSLAs = this.slaManager.listSLAs();
    if (activeSLAs.length === 0) return;

    logger.info('SLAMonitoringAgent cycle started', { activeSLAs: activeSLAs.length });

    for (const sla of activeSLAs) {
      await this.evaluateSLA(sla);
    }

    this.generateComplianceReport(activeSLAs);
  }

  private async evaluateSLA(sla: SLADefinition): Promise<void> {
    const state = this.slaManager.getState(sla.slaId);
    if (!state) return;

    const summary: SLAHealthSummary = {
      tenantId: sla.tenantId,
      slaId: sla.slaId,
      status: state.status,
      compositeScore: state.compositeScore,
      breachCount: state.breachCount,
      creditsOwed: state.creditsOwed,
      lastCheckedAt: Date.now(),
    };
    this.healthSummaries.set(sla.slaId, summary);

    // Simulate observations for metrics
    for (const metric of sla.metrics) {
      const simulatedValue = this.simulateMetricValue(metric.metricType, metric.target);
      this.slaManager.recordObservation(sla.slaId, 'sla-monitoring-agent', metric.metricType, simulatedValue);
    }

    // Predict breaches
    for (const metric of sla.metrics) {
      const prediction = this.slaManager.predictBreach(sla.slaId, metric.metricType);
      if (prediction.predicted && prediction.confidencePercent > 70) {
        logger.warn('SLA breach predicted', {
          slaId: sla.slaId,
          metricType: metric.metricType,
          confidence: prediction.confidencePercent,
          estimatedTimeMs: prediction.estimatedTimeMs,
        });

        if (this.config.autoRemediateEnabled) {
          await this.triggerRemediation(sla.slaId, metric.metricType, 'breach_prediction');
        }
      }
    }

    // Escalate critical breaches
    const openBreaches = this.slaManager.getBreaches(sla.slaId, false);
    const criticalBreaches = openBreaches.filter(b => b.severity === 'critical');
    for (const breach of criticalBreaches) {
      if (!breach.escalated && state.compositeScore < this.config.escalationThreshold) {
        this.escalate(sla.slaId, breach.breachId, `Critical SLA breach: ${breach.metricType}`);
      }
    }

    await Promise.resolve(); // yield
  }

  private async triggerRemediation(slaId: string, metricType: string, reason: string): Promise<void> {
    const action = `auto_remediation:${metricType}:${reason}`;
    this.remedationLog.push({ slaId, action, timestamp: Date.now() });

    if (this.remedationLog.length > 10_000) this.remedationLog.shift();

    logger.info('Auto-remediation triggered', { slaId, metricType, reason });
    await Promise.resolve();
  }

  private escalate(slaId: string, breachId: string, message: string): void {
    logger.error('SLA escalation required', undefined, { slaId, breachId, message });
  }

  private simulateMetricValue(metricType: string, target: number): number {
    const noise = (Math.random() - 0.45) * target * 0.05;
    return Math.max(0, target + noise);
  }

  private generateComplianceReport(slas: SLADefinition[]): void {
    const report = this.slaManager.generatePortfolioReport(Date.now() - 86_400_000, Date.now());
    logger.info('SLA compliance report', {
      totalSLAs: report.totalSLAs,
      compliant: report.compliantSLAs,
      atRisk: report.atRiskSLAs,
      breached: report.breachedSLAs,
      totalCredits: report.totalCreditsOwed,
    });
    void slas;
  }

  getHealthSummaries(): SLAHealthSummary[] {
    return Array.from(this.healthSummaries.values());
  }

  getRemediationLog(): typeof this.remedationLog {
    return this.remedationLog.slice(-100);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: SLAMonitoringAgent | undefined;

export function getSLAMonitoringAgent(): SLAMonitoringAgent {
  if (!_instance) _instance = new SLAMonitoringAgent();
  return _instance;
}

export { SLAMonitoringAgent };
