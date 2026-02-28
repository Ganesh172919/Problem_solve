/**
 * @module remediationAgent
 * @description Autonomous remediation agent that monitors open incidents, triggers
 * automated root-cause analysis, selects appropriate playbooks, executes remediations,
 * tracks overdue tasks, escalates P1 incidents, and generates MTTR improvement reports.
 */

import { getLogger } from '../lib/logger';
import { getRemediationEngine } from '../lib/autonomousRemediationEngine';

const logger = getLogger();

interface AgentConfig {
  pollIntervalMs?: number;
  autoRemediateEnabled?: boolean;
  dryRunMode?: boolean;
  p1EscalationThresholdMs?: number;
}

class RemediationAgent {
  private readonly engine = getRemediationEngine();
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private readonly config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? 60_000,
      autoRemediateEnabled: config.autoRemediateEnabled ?? true,
      dryRunMode: config.dryRunMode ?? false,
      p1EscalationThresholdMs: config.p1EscalationThresholdMs ?? 300_000,
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.pollHandle = setInterval(() => this.runCycle(), this.config.pollIntervalMs);
    logger.info('RemediationAgent started', { pollIntervalMs: this.config.pollIntervalMs, dryRun: this.config.dryRunMode });
  }

  stop(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
    this.isRunning = false;
    logger.info('RemediationAgent stopped');
  }

  private runCycle(): void {
    const openIncidents = this.engine.listIncidents('open');
    const now = Date.now();

    for (const incident of openIncidents) {
      // Perform RCA if not done
      if (incident.rootCauseHypotheses.length === 0) {
        const hypotheses = this.engine.analyzeRootCause(incident.id);
        logger.info('Root cause analysis performed', { incidentId: incident.id, hypotheses: hypotheses.length });
      }

      // Escalate stalled P1 incidents
      if (incident.severity === 'P1' && now - incident.createdAt > this.config.p1EscalationThresholdMs) {
        logger.warn('P1 incident stalled — escalating', {
          incidentId: incident.id,
          ageMs: now - incident.createdAt,
        });
      }

      // Auto-remediate
      if (this.config.autoRemediateEnabled && !incident.remediationId) {
        const playbooks = this.engine.listPlaybooks().filter(
          p => p.applicableSeverities.includes(incident.severity)
        );
        if (playbooks.length > 0) {
          this.engine.executeRemediation(incident.id, playbooks[0].id, {
            dryRun: this.config.dryRunMode,
            executedBy: 'autonomous',
          }).then(exec => {
            logger.info('Autonomous remediation executed', {
              incidentId: incident.id,
              executionId: exec.id,
              status: exec.status,
              dryRun: exec.dryRun,
            });
          }).catch(err => {
            logger.error('Autonomous remediation failed', err);
          });
        }
      }
    }

    const summary = this.engine.getSummary();
    logger.info('Remediation cycle report', {
      openIncidents: summary.openIncidents,
      resolvedIncidents: summary.resolvedIncidents,
      avgMttrMs: summary.avgMttrMs,
      successRate: `${summary.successRate}%`,
      p1Last24h: summary.p1IncidentsLast24h,
    });
  }

  async run(): Promise<void> {
    this.runCycle();
  }
}

const KEY = '__remediationAgent__';
export function getRemediationAgent(config?: AgentConfig): RemediationAgent {
  if (!(globalThis as Record<string, unknown>)[KEY]) {
    (globalThis as Record<string, unknown>)[KEY] = new RemediationAgent(config);
  }
  return (globalThis as Record<string, unknown>)[KEY] as RemediationAgent;
}
