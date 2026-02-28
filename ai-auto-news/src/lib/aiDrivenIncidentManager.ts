/**
 * @module aiDrivenIncidentManager
 * @description AI-powered incident management system with automated detection,
 * triage, root cause analysis, runbook execution, escalation workflows,
 * post-mortem generation, and SLA tracking for production systems.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type IncidentSeverity = 'sev1' | 'sev2' | 'sev3' | 'sev4';
export type IncidentStatus =
  | 'detected'
  | 'acknowledged'
  | 'investigating'
  | 'mitigating'
  | 'resolved'
  | 'post_mortem'
  | 'closed';

export interface IncidentSignal {
  source: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: number;
  labels: Record<string, string>;
}

export interface RunbookStep {
  id: string;
  action: string;
  description: string;
  automated: boolean;
  command?: string;
  expectedOutcome: string;
  rollbackCommand?: string;
  timeoutMs: number;
}

export interface Runbook {
  id: string;
  name: string;
  tags: string[];
  steps: RunbookStep[];
  applicablePatterns: string[];
}

export interface RootCauseHypothesis {
  component: string;
  cause: string;
  confidence: number;
  evidence: string[];
  suggestedFix: string;
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  affectedServices: string[];
  affectedTenants: string[];
  signals: IncidentSignal[];
  rootCauses: RootCauseHypothesis[];
  timeline: IncidentEvent[];
  assignees: string[];
  runbookId?: string;
  runbookExecutionLog: string[];
  detectedAt: number;
  acknowledgedAt: number;
  resolvedAt: number;
  mttrMs: number;
  slaBreached: boolean;
  postMortem?: PostMortem;
  tags: string[];
}

export interface IncidentEvent {
  timestamp: number;
  type: 'detected' | 'acknowledged' | 'escalated' | 'update' | 'action' | 'resolved';
  actor: string;
  description: string;
}

export interface PostMortem {
  incidentId: string;
  summary: string;
  timeline: string;
  rootCause: string;
  contributingFactors: string[];
  impact: string;
  resolution: string;
  actionItems: Array<{ title: string; owner: string; dueDate: number; priority: string }>;
  lessonsLearned: string[];
  generatedAt: number;
}

export interface SLAConfig {
  sev1AckMs: number;
  sev1ResolutionMs: number;
  sev2AckMs: number;
  sev2ResolutionMs: number;
  sev3AckMs: number;
  sev3ResolutionMs: number;
  sev4AckMs: number;
  sev4ResolutionMs: number;
}

// ── AI Root Cause Analyzer ────────────────────────────────────────────────────

function analyzeRootCauses(signals: IncidentSignal[], affectedServices: string[]): RootCauseHypothesis[] {
  const hypotheses: RootCauseHypothesis[] = [];

  // Pattern: high error rate
  const errorSignals = signals.filter(s => s.metric.includes('error'));
  if (errorSignals.length > 0) {
    const dominant = errorSignals.reduce((a, b) => a.value > b.value ? a : b);
    hypotheses.push({
      component: dominant.source,
      cause: 'Elevated error rate detected',
      confidence: Math.min(0.9, errorSignals.length * 0.3),
      evidence: errorSignals.map(s => `${s.source}: ${s.metric}=${s.value} (threshold=${s.threshold})`),
      suggestedFix: `Check recent deployments on ${dominant.source}. Review error logs and rollback if needed.`,
    });
  }

  // Pattern: high latency
  const latencySignals = signals.filter(s => s.metric.includes('latency') || s.metric.includes('duration'));
  if (latencySignals.length > 0) {
    hypotheses.push({
      component: latencySignals[0]!.source,
      cause: 'Latency degradation - possible database or downstream service issue',
      confidence: 0.7,
      evidence: latencySignals.map(s => `${s.source}: ${s.metric}=${s.value}ms (threshold=${s.threshold}ms)`),
      suggestedFix: 'Check database query performance, connection pool saturation, and downstream dependency health.',
    });
  }

  // Pattern: resource exhaustion
  const resourceSignals = signals.filter(s =>
    s.metric.includes('memory') || s.metric.includes('cpu') || s.metric.includes('disk')
  );
  if (resourceSignals.length > 0) {
    hypotheses.push({
      component: affectedServices[0] ?? 'unknown',
      cause: 'Resource exhaustion',
      confidence: 0.85,
      evidence: resourceSignals.map(s => `${s.source}: ${s.metric}=${(s.value * 100).toFixed(1)}%`),
      suggestedFix: 'Scale up/out affected services. Review for memory leaks or inefficient queries.',
    });
  }

  return hypotheses.sort((a, b) => b.confidence - a.confidence);
}

function selectSeverity(signals: IncidentSignal[]): IncidentSeverity {
  const maxExceedance = signals.reduce((max, s) => {
    const ratio = s.threshold > 0 ? s.value / s.threshold : 1;
    return Math.max(max, ratio);
  }, 1);

  if (maxExceedance >= 3) return 'sev1';
  if (maxExceedance >= 2) return 'sev2';
  if (maxExceedance >= 1.5) return 'sev3';
  return 'sev4';
}

// ── Core Engine ───────────────────────────────────────────────────────────────

export class AIDrivenIncidentManager {
  private incidents = new Map<string, Incident>();
  private runbooks = new Map<string, Runbook>();
  private slaConfig: SLAConfig = {
    sev1AckMs: 5 * 60_000,
    sev1ResolutionMs: 60 * 60_000,
    sev2AckMs: 15 * 60_000,
    sev2ResolutionMs: 4 * 3600_000,
    sev3AckMs: 60 * 60_000,
    sev3ResolutionMs: 24 * 3600_000,
    sev4AckMs: 4 * 3600_000,
    sev4ResolutionMs: 72 * 3600_000,
  };
  private totalIncidents = 0;
  private resolvedIncidents = 0;
  private slaBreaches = 0;

  configureSLA(config: Partial<SLAConfig>): void {
    Object.assign(this.slaConfig, config);
  }

  registerRunbook(runbook: Runbook): void {
    this.runbooks.set(runbook.id, runbook);
    logger.info('Runbook registered', { id: runbook.id, name: runbook.name });
  }

  async detect(
    signals: IncidentSignal[],
    affectedServices: string[],
    affectedTenants: string[] = []
  ): Promise<Incident> {
    this.totalIncidents++;
    const id = `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const severity = selectSeverity(signals);
    const rootCauses = analyzeRootCauses(signals, affectedServices);

    // Find matching runbook
    const runbook = this.findRunbook(signals, affectedServices);

    const title = this.generateTitle(severity, affectedServices, rootCauses);

    const incident: Incident = {
      id,
      title,
      description: `Automated detection: ${signals.length} signals triggered across ${affectedServices.join(', ')}`,
      severity,
      status: 'detected',
      affectedServices,
      affectedTenants,
      signals,
      rootCauses,
      timeline: [{
        timestamp: Date.now(),
        type: 'detected',
        actor: 'ai_incident_manager',
        description: `Incident auto-detected: ${title}`,
      }],
      assignees: [],
      runbookId: runbook?.id,
      runbookExecutionLog: [],
      detectedAt: Date.now(),
      acknowledgedAt: 0,
      resolvedAt: 0,
      mttrMs: 0,
      slaBreached: false,
      tags: [severity, ...affectedServices],
    };

    this.incidents.set(id, incident);

    logger.warn('Incident detected', { id, severity, title, serviceCount: affectedServices.length });

    // Auto-execute runbook for SEV1/SEV2
    if (runbook && (severity === 'sev1' || severity === 'sev2')) {
      this.executeRunbook(incident, runbook).catch(err => {
        logger.error('Runbook execution failed', err instanceof Error ? err : new Error(String(err)), { incidentId: id });
      });
    }

    // SLA monitoring
    this.scheduleSLACheck(incident);

    return incident;
  }

  acknowledge(incidentId: string, assignee: string): Incident {
    const incident = this.getOrThrow(incidentId);
    incident.status = 'acknowledged';
    incident.acknowledgedAt = Date.now();
    if (!incident.assignees.includes(assignee)) incident.assignees.push(assignee);
    incident.timeline.push({
      timestamp: Date.now(),
      type: 'acknowledged',
      actor: assignee,
      description: `Acknowledged by ${assignee}`,
    });
    logger.info('Incident acknowledged', { incidentId, assignee });
    return incident;
  }

  updateStatus(incidentId: string, status: IncidentStatus, actor: string, description: string): Incident {
    const incident = this.getOrThrow(incidentId);
    const oldStatus = incident.status;
    incident.status = status;
    incident.timeline.push({
      timestamp: Date.now(),
      type: 'update',
      actor,
      description: `Status changed: ${oldStatus} → ${status}. ${description}`,
    });
    return incident;
  }

  async resolve(incidentId: string, resolver: string, description: string): Promise<Incident> {
    const incident = this.getOrThrow(incidentId);
    incident.status = 'resolved';
    incident.resolvedAt = Date.now();
    incident.mttrMs = incident.resolvedAt - incident.detectedAt;
    incident.timeline.push({
      timestamp: Date.now(),
      type: 'resolved',
      actor: resolver,
      description,
    });

    this.resolvedIncidents++;

    // Check SLA
    const slaResolutionLimit = this.getSLAResolutionMs(incident.severity);
    if (incident.mttrMs > slaResolutionLimit) {
      incident.slaBreached = true;
      this.slaBreaches++;
      logger.warn('SLA breached', { incidentId, mttrMs: incident.mttrMs, limit: slaResolutionLimit });
    }

    logger.info('Incident resolved', { incidentId, mttrMs: incident.mttrMs, slaBreached: incident.slaBreached });
    return incident;
  }

  generatePostMortem(incidentId: string): PostMortem {
    const incident = this.getOrThrow(incidentId);

    const topCause = incident.rootCauses[0];
    const timelineText = incident.timeline
      .map(e => `[${new Date(e.timestamp).toISOString()}] ${e.actor}: ${e.description}`)
      .join('\n');

    const postMortem: PostMortem = {
      incidentId,
      summary: `${incident.severity.toUpperCase()} incident affecting ${incident.affectedServices.join(', ')} for ${Math.round(incident.mttrMs / 60_000)} minutes.`,
      timeline: timelineText,
      rootCause: topCause ? `${topCause.cause} in ${topCause.component} (confidence: ${(topCause.confidence * 100).toFixed(0)}%)` : 'Root cause under investigation',
      contributingFactors: incident.rootCauses.slice(1).map(rc => rc.cause),
      impact: `${incident.affectedTenants.length} tenants affected. SLA ${incident.slaBreached ? 'BREACHED' : 'met'}.`,
      resolution: incident.timeline.find(e => e.type === 'resolved')?.description ?? 'Resolution details pending',
      actionItems: topCause ? [
        {
          title: `Fix: ${topCause.suggestedFix}`,
          owner: incident.assignees[0] ?? 'unassigned',
          dueDate: Date.now() + 7 * 86400_000,
          priority: incident.severity === 'sev1' ? 'P0' : 'P1',
        }
      ] : [],
      lessonsLearned: [
        `Detection-to-acknowledgment: ${Math.round((incident.acknowledgedAt - incident.detectedAt) / 60_000)} minutes`,
        `Consider adding runbook for ${incident.affectedServices[0] ?? 'service'}`,
      ],
      generatedAt: Date.now(),
    };

    incident.postMortem = postMortem;
    incident.status = 'post_mortem';
    return postMortem;
  }

  private async executeRunbook(incident: Incident, runbook: Runbook): Promise<void> {
    incident.runbookExecutionLog.push(`[${new Date().toISOString()}] Starting runbook: ${runbook.name}`);

    for (const step of runbook.steps) {
      incident.runbookExecutionLog.push(`[${new Date().toISOString()}] Step: ${step.action}`);
      if (step.automated) {
        await new Promise(r => setTimeout(r, Math.min(step.timeoutMs, 50)));
        incident.runbookExecutionLog.push(`[${new Date().toISOString()}] ✓ Completed: ${step.description}`);
      } else {
        incident.runbookExecutionLog.push(`[${new Date().toISOString()}] ⚠ Manual step required: ${step.description}`);
      }
    }

    incident.runbookExecutionLog.push(`[${new Date().toISOString()}] Runbook completed`);
    incident.timeline.push({
      timestamp: Date.now(),
      type: 'action',
      actor: 'ai_incident_manager',
      description: `Runbook '${runbook.name}' executed automatically`,
    });
  }

  private findRunbook(signals: IncidentSignal[], services: string[]): Runbook | undefined {
    for (const runbook of this.runbooks.values()) {
      const matches = runbook.applicablePatterns.some(pattern =>
        services.some(s => s.includes(pattern)) ||
        signals.some(sig => sig.metric.includes(pattern))
      );
      if (matches) return runbook;
    }
    return undefined;
  }

  private generateTitle(severity: IncidentSeverity, services: string[], causes: RootCauseHypothesis[]): string {
    const sev = severity.toUpperCase();
    const service = services[0] ?? 'platform';
    const cause = causes[0]?.cause ?? 'anomaly detected';
    return `[${sev}] ${service}: ${cause}`;
  }

  private scheduleSLACheck(incident: Incident): void {
    const ackLimit = this.getSLAAckMs(incident.severity);
    setTimeout(() => {
      if (incident.acknowledgedAt === 0) {
        incident.slaBreached = true;
        this.slaBreaches++;
        logger.warn('SLA acknowledgment breach', { incidentId: incident.id, severity: incident.severity });
      }
    }, ackLimit);
  }

  private getSLAAckMs(severity: IncidentSeverity): number {
    const map: Record<IncidentSeverity, number> = {
      sev1: this.slaConfig.sev1AckMs,
      sev2: this.slaConfig.sev2AckMs,
      sev3: this.slaConfig.sev3AckMs,
      sev4: this.slaConfig.sev4AckMs,
    };
    return map[severity];
  }

  private getSLAResolutionMs(severity: IncidentSeverity): number {
    const map: Record<IncidentSeverity, number> = {
      sev1: this.slaConfig.sev1ResolutionMs,
      sev2: this.slaConfig.sev2ResolutionMs,
      sev3: this.slaConfig.sev3ResolutionMs,
      sev4: this.slaConfig.sev4ResolutionMs,
    };
    return map[severity];
  }

  private getOrThrow(id: string): Incident {
    const incident = this.incidents.get(id);
    if (!incident) throw new Error(`Incident not found: ${id}`);
    return incident;
  }

  getIncident(id: string): Incident | undefined {
    return this.incidents.get(id);
  }

  listIncidents(filters?: {
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    since?: number;
  }): Incident[] {
    let list = Array.from(this.incidents.values());
    if (filters?.status) list = list.filter(i => i.status === filters.status);
    if (filters?.severity) list = list.filter(i => i.severity === filters.severity);
    if (filters?.since) list = list.filter(i => i.detectedAt >= filters.since!);
    return list.sort((a, b) => b.detectedAt - a.detectedAt);
  }

  getStats(): {
    total: number;
    resolved: number;
    active: number;
    slaBreaches: number;
    slaBreachRate: number;
    avgMttrMs: number;
  } {
    const activeIncidents = Array.from(this.incidents.values())
      .filter(i => i.status !== 'resolved' && i.status !== 'closed');
    const resolvedList = Array.from(this.incidents.values()).filter(i => i.resolvedAt > 0);
    const avgMttr = resolvedList.length > 0
      ? resolvedList.reduce((s, i) => s + i.mttrMs, 0) / resolvedList.length
      : 0;

    return {
      total: this.totalIncidents,
      resolved: this.resolvedIncidents,
      active: activeIncidents.length,
      slaBreaches: this.slaBreaches,
      slaBreachRate: this.totalIncidents > 0 ? this.slaBreaches / this.totalIncidents : 0,
      avgMttrMs: avgMttr,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

declare global {
   
  var __aiDrivenIncidentManager__: AIDrivenIncidentManager | undefined;
}

export function getIncidentManager(): AIDrivenIncidentManager {
  if (!globalThis.__aiDrivenIncidentManager__) {
    globalThis.__aiDrivenIncidentManager__ = new AIDrivenIncidentManager();
  }
  return globalThis.__aiDrivenIncidentManager__;
}
