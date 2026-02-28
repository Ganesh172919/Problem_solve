/**
 * @module configDriftAgent
 * @description Autonomous configuration drift detection agent that periodically
 * scans for drift, creates remediations for critical violations, reports on
 * compliance scores, and tracks change velocity across all managed services.
 */

import { getLogger } from '../lib/logger';
import { getConfigDriftDetector } from '../lib/autonomousConfigDriftDetector';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  autoRemediateEnabled?: boolean;
  autoRemediateMinSeverity?: 'critical' | 'high';
  complianceAlertThreshold?: number;
}

class ConfigDriftAgent {
  private readonly detector = getConfigDriftDetector();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 120_000,
      autoRemediateEnabled: config.autoRemediateEnabled ?? true,
      autoRemediateMinSeverity: config.autoRemediateMinSeverity ?? 'high',
      complianceAlertThreshold: config.complianceAlertThreshold ?? 70,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => this.run(), this.config.pollIntervalMs);
    logger.info('ConfigDriftAgent started', { pollIntervalMs: this.config.pollIntervalMs });
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.isRunning = false;
    logger.info('ConfigDriftAgent stopped');
  }

  async run(): Promise<void> {
    const summary = this.detector.getSummary();
    logger.info('Config drift report', {
      driftedServices: summary.driftedServices,
      avgComplianceScore: summary.avgComplianceScore.toFixed(1),
      criticalDrifts: summary.criticalDriftsOpen,
      pendingRemediations: summary.pendingRemediations,
    });

    if (summary.avgComplianceScore < this.config.complianceAlertThreshold) {
      logger.warn('Compliance score below threshold', {
        score: summary.avgComplianceScore.toFixed(1),
        threshold: this.config.complianceAlertThreshold,
      });
    }

    // Auto-remediate critical/high drifts
    if (this.config.autoRemediateEnabled) {
      const reports = this.detector.listReports();
      const targetSeverities = this.config.autoRemediateMinSeverity === 'critical'
        ? ['critical']
        : ['critical', 'high'];

      for (const report of reports.slice(0, 10)) {
        const hasSevereDrift = report.driftItems.some(
          d => targetSeverities.includes(d.severity) && d.remediable
        );
        if (hasSevereDrift && report.remediable) {
          const pending = this.detector.listRemediations(report.tenantId, 'pending')
            .find(r => r.reportId === report.id);
          if (!pending) {
            const action = this.detector.createRemediation(report.id, 'config_drift_agent');
            logger.info('Auto-remediation created', {
              id: action.id,
              reportId: report.id,
              serviceId: report.serviceId,
              paths: action.driftPaths,
            });
          }
        }
      }
    }
  }
}

const KEY = '__configDriftAgent__';
export function getConfigDriftAgent(config?: AgentConfig): ConfigDriftAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new ConfigDriftAgent(config);
  }
  return (globalThis as Record<string, unknown>)[KEY] as ConfigDriftAgent;
}
